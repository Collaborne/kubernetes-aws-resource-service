#!/usr/bin/env node

'use strict';

const yargs = require('yargs');
const fs = require('fs');
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
	k8sConfig = {
		url: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
		ca: fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8'),
		auth: { bearer: fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8') }
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
	 * @return {Object} the queue attributes
	 */
	function translateQueueAttributes(queue) {
		function capitalize(s) {
			return s[0].toUpperCase() + s.substring(1);
		}

		return Object.keys(queue.spec || {}).reduce((result, key) => {
			const value = queue.spec[key];
			let resultValue;
			switch (key) {
			case 'redrivePolicy':
			case 'policy':
				resultValue = JSON.stringify(value);
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

			return sqs.createQueue({ QueueName: queue.metadata.name, Attributes: translateQueueAttributes(queue) }, handleCreateQueueResponse);
		});
	}

	function updateQueue(queue) {
		return new Promise(function(resolve, reject) {
			return sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					return reject(err);
				}

				return sqs.setQueueAttributes({ QueueUrl: data.QueueUrl, Attributes: translateQueueAttributes(queue) }, function(err, data) {
					if (err) {
						return reject(err);
					}

					return resolve(data);
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
		const watch = queues.watch(resourceVersion)
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
