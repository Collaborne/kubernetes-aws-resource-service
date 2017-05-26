#!/usr/bin/env node

'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const logger = require('log4js').getLogger();

const argv = yargs
	.alias('s', 'server').describe('server', 'The address and port of the Kubernetes API server')
	.alias('cacert', 'certificate-authority').describe('certificate-authority', 'Path to a cert. file for the certificate authority')
	.alias('cert', 'client-certificate').describe('client-certificate', 'Path to a client certificate file for TLS')
	.alias('key', 'client-key').describe('client-key', 'Path to a client key file for TLS')
	.boolean('insecure-skip-tls-verify').describe('insecure-skip-tls-verify', 'If true, the server\'s certificate will not be checked for validity. This will make your HTTPS connections insecure')
	.describe('token', 'Bearer token for authentication to the API server')
	.describe('namespace', 'The namespace to watch')
	.help()
	.argv;

/** The basic configuration for accessing the API server */
let k8sConfig;
if (argv.server) {
	const fs = require('fs');

	k8sConfig = {
		url: argv.server,
		insecureSkipTlsVerify: argv.insecureSkipTlsVerify
	};
	if (argv.certificateAuthority) {
		k8sConfig.ca = fs.readFileSync(argv.certificateAuthority, 'utf8');
	}
	if (argv.token) {
		k8sConfig.auth = { bearer: argv.token };
	} else if (argv.username && argv.password) {
		k8sConfig.auth = { user: argv.username, pass: argv.password };
	} else if (argv.clientCertificate && argv.clientKey) {
		k8sConfig.cert = fs.readFileSync(argv.clientCertificate, 'utf8');
		k8sConfig.key = fs.readFileSync(argv.clientKey, 'utf8');
	}
} else if (process.env.KUBERNETES_SERVICE_HOST) {
	const credentialsPath = '/var/run/secrets/kubernetes.io/serviceaccount/';
	k8sConfig = {
		url: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
		ca: fs.readFileSync(path.resolve(credentialsPath, 'ca.crt'), 'utf8'),
		auth: { bearer: fs.readFileSync(path.resolve(credentialsPath, 'token'), 'utf8') }
	}
} else {
	logger.error('Unknown Kubernetes API server');
	process.exit(1);
}

const k8s = require('auto-kubernetes-client');
const sqs = new AWS.SQS({
	endpoint: process.env.AWS_SQS_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
});

if (!argv.namespace) {
	// FIXME: How to do watching without namespace (i.e. "all namespaces")
	logger.error('Must provide a namespace using --namespace');
	process.exit(1);
}

k8s(k8sConfig).then(function(k8sClient) {
	const queues = k8sClient.group('aws.k8s.collaborne.com', 'v1').ns(argv.namespace).queues;

	/**
	 * Convert the queue.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Object} queue a queue definition
	 * @param {String} [queueArn] the ARN of the queue
	 * @return {Object} the queue attributes
	 */
	function translateQueueAttributes(queue, queueArn) {
		function capitalize(s) {
			return s[0].toUpperCase() + s.substring(1);
		}

		return Object.keys(queue.spec || {}).reduce((result, key) => {
			const value = queue.spec[key];
			let resultValue;
			switch (key) {
			case 'redrivePolicy':
				resultValue = JSON.stringify(value);
				break;
			case 'policy':
				// Inject the queue ARN as 'Resource' into all statements of the policy
				let policy;
				if (queueArn) {
					logger.debug(`[${queue.metadata.name}]: Injecting resource ARN ${queueArn} into policy document`)
					policy = Object.assign({}, value, { Statement: (value.Statement || []).map(statement => Object.assign({Resource: queueArn}, statement)) });
				} else {
					policy = value;
				}

				resultValue = JSON.stringify(policy);
				break;
			default:
				// Convert to string
				resultValue = `${value}`;
				break;
			}
			logger.debug(`[${queue.metadata.name}]: Attribute ${key} = ${resultValue}`);

			result[capitalize(key)] = resultValue;
			return result;
		}, {});
	}

	function createQueue(queue) {
		return new Promise(function(resolve, reject) {
			function handleCreateQueueResponse(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
						// Schedule to retry the operation in 10s
						logger.info(`[${queue.metadata.name}]: Retrying for recently deleted queue`);
						return setTimeout(function() {
							return createQueue(queue).then(data => handleCreateQueueResponse(null, data), err => handleCreateQueueResponse(err, null));
						}, 10000);
					}
					return reject(err);
				}

				return resolve(data);
			}

			const attributes = translateQueueAttributes(queue);
			return sqs.createQueue({ QueueName: queue.metadata.name, Attributes: attributes }, handleCreateQueueResponse);
		});
	}

	function updateQueue(queue) {
		return new Promise(function(resolve, reject) {
			return sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					return reject(err);
				}

				const queueUrl = data.QueueUrl;
				return sqs.getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: [ 'QueueArn' ] }, function(err, data) {
					if (err) {
						return reject(err);
					}

					const attributes = translateQueueAttributes(queue, data.Attributes.QueueArn);
					if (Object.keys(attributes).length === 0) {
						// The API requires that we provide attributes when trying to update attributes.
						// If the caller intended to set values to their defaults, then they must be explicit and
						// provide these values. In other words: AWS SQS copies the defaults at creation time, and
						// afterwards there is no such thing as a "default" anymore.
						// From our side though this is not an error, but we merely ignore the request.
						// See also a similar change in Apache Camel: https://issues.apache.org/jira/browse/CAMEL-5782
						logger.warn(`[${queue.metadata.name}]: Ignoring update without attributes`);
						return resolve();
					}
					

					return sqs.setQueueAttributes({ QueueUrl: queueUrl, Attributes: attributes }, function(err, data) {
						if (err) {
							return reject(err);
						}

						return resolve(data);
					});
				});
			});
		});
	}

	function deleteQueue(queue) {
		return new Promise(function(resolve, reject) {
			return sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					return reject(err);
				}

				return sqs.deleteQueue({ QueueUrl: data.QueueUrl }, function(err, data) {
					if (err) {
						return reject(err);
					}

					return resolve(data);
				});
			});
		});
	}

	function mainLoop() {
		// Highest version seen
		let resourceVersion = 0;

		// Known promises for queues, used to synchronize requests and avoid races between delayed creations and modifications.
		const queuePromises = {};

		logger.info(`Watching queues at ${resourceVersion}...`);
		queues.watch(resourceVersion)
			.on('data', function(item) {
				const queue = item.object;

				// Update the version: we've processed things until here now
				resourceVersion = queue.metadata.resourceVersion;
				const name = queue.metadata.name;

				// Enqueue the request to happen when the previous request is done.
				const previousPromise = queuePromises[name] || Promise.resolve();

				let result;
				
				switch (item.type) {
				case 'ADDED':
					result = previousPromise.then(function() {
						logger.info(`[${name}]: Creating queue`);
						return createQueue(queue);
					});
					break;
				case 'MODIFIED':
					result = previousPromise.then(function() {
						logger.info(`[${name}]: Updating queue attributes`);
						return updateQueue(queue);
					});
					break;
				case 'DELETED':
					result = previousPromise.then(function() {
						logger.info(`[${name}]: Deleting queue`);
						return deleteQueue(queue);
					});
					break;
				case 'ERROR':
					// Log the message, and continue: usually the stream would end now, but there might be more events
					// in it that we do want to consume.
					logger.warn(`Error while watching: ${item.object.message}, ignoring`);
					return;
				default:
					logger.warn(`Unkown watch event type ${item.type}, ignoring`);
					return;
				}

				result = result.then(function(data) {
					logger.info(`[${name}]: ${JSON.stringify(data)}`);
				}, function(err) {
					logger.error(`[${name}]: ${err.message} (${err.code})`);
				});

				// Note that we retain the 'rejected' state here: an existing queue that ended in a rejection
				// will effectively stay rejected.
				queuePromises[name] = result;

				return result;
			})
			.on('end', function() {
				// Restart the whole thing.
				logger.info('Watch ended, re-syncing everything');
				return mainLoop();
			});
	}

	// Start!
	mainLoop();
}).catch(function(err) {
	logger.error(`Uncaught error, aborting: ${err.message}`);
	process.exit(1);
});
