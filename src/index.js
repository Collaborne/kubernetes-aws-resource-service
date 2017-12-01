#!/usr/bin/env node

'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const k8s = require('auto-kubernetes-client');

const logger = require('log4js').getLogger();

const argv = yargs
	.alias('s', 'server').describe('server', 'The address and port of the Kubernetes API server')
	.alias('cacert', 'certificate-authority').describe('certificate-authority', 'Path to a cert. file for the certificate authority')
	.alias('cert', 'client-certificate').describe('client-certificate', 'Path to a client certificate file for TLS')
	.alias('key', 'client-key').describe('client-key', 'Path to a client key file for TLS')
	.boolean('insecure-skip-tls-verify').describe('insecure-skip-tls-verify', 'If true, the server\'s certificate will not be checked for validity. This will make your HTTPS connections insecure')
	.describe('token', 'Bearer token for authentication to the API server')
	.describe('namespace', 'The namespace to watch').demandOption('namespace')
	.help()
	.argv;

/**
 * Creates basic configuration for accessing the Kubernetes API server
 *
 * @param {Object} argv Command line arguments
 * @returns {Object} Kubernetes client configuration
 */
function createK8sConfig(argv) {
	let k8sConfig;
	if (argv.server) {
		// For local development
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
		// Runs in Kubernetes
		const credentialsPath = '/var/run/secrets/kubernetes.io/serviceaccount/';
		k8sConfig = {
			url: `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`,
			ca: fs.readFileSync(path.resolve(credentialsPath, 'ca.crt'), 'utf8'),
			auth: { bearer: fs.readFileSync(path.resolve(credentialsPath, 'token'), 'utf8') }
		}
	} else {
		throw new Error('Unknown Kubernetes API server');
	}

	return k8sConfig;
}

// TODO: Move into Plugin
const sqs = new AWS.SQS({
	endpoint: process.env.AWS_SQS_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
});

const k8sConfig = createK8sConfig(argv);
k8s(k8sConfig).then(function(k8sClient) {
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

	/**
	 *
	 * @param {AWSError|Error} err
	 */
	function isTransientNetworkError(err) {
		return err.code === 'NetworkingError' && (err.errno === 'EHOSTUNREACH' || err.errno === 'ECONNREFUSED');
	}

	/**
	 * Resolve a promise using the given `resolve` after the `timeout` has passed by retrying `operation` on `queue`.
	 *
	 * @param {Function} resolve
	 * @param {Function} operation
	 * @param {Number} after
	 * @param {Queue} queue
	 */
	function resolveRetry(resolve, operation, after, queue, cause) {
		logger.warn(`[${queue.metadata.name}]: ${cause}, retrying in ${after/1000}s`);
		return setTimeout(function() {
			return resolve(operation(queue));
		}, after);
	}

	function createQueue(queue) {
		return new Promise(function(resolve, reject) {
			const attributes = translateQueueAttributes(queue);
			return sqs.createQueue({ QueueName: queue.metadata.name, Attributes: attributes }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
						return resolveRetry(resolve, createQueue, 10000, queue, 'queue recently deleted');
					} else if (isTransientNetworkError(err)) {
						return resolveRetry(resolve, createQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot create queue: ${err.message}`);
					return reject(err);
				}

				return resolve(data);
			});
		});
	}

	function updateQueue(queue) {
		return new Promise(function(resolve, reject) {
			return sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.NonExistentQueue') {
						// Queue doesn't exist: this means kubernetes saw an update, but in fact the queue was never created,
						// or has been deleted in the meantime. Create it again.
						logger.info(`[${queue.metadata.name}]: Queue does not/no longer exist, re-creating it`);
						return resolve(createQueue(queue));
					} else if (isTransientNetworkError(err)) {
						return resolveRetry(resolve, updateQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				const queueUrl = data.QueueUrl;
				return sqs.getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: [ 'QueueArn' ] }, function(err, data) {
					if (err) {
						if (isTransientNetworkError(err)) {
							return resolveRetry(resolve, updateQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
						}

						logger.warn(`[${queue.metadata.name}]: Cannot determine queue ARN: ${err.message}`);
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
							if (isTransientNetworkError(err)) {
								return resolveRetry(resolve, updateQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
							}

							logger.warn(`[${queue.metadata.name}]: Cannot update queue attributes: ${err.message}`);
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
					if (isTransientNetworkError(err)) {
						return resolveRetry(resolve, deleteQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				return sqs.deleteQueue({ QueueUrl: data.QueueUrl }, function(err, data) {
					if (err) {
						if (isTransientNetworkError(err)) {
							return resolveRetry(resolve, deleteQueue, 30000, queue, `transient ${err.code} ${err.errno}`);
						}

						logger.warn(`[${queue.metadata.name}]: Cannot delete queue: ${err.message}`);
						return reject(err);
					}

					return resolve(data);
				});
			});
		});
	}

	const queues = k8sClient.group('aws.k8s.collaborne.com', 'v1').ns(argv.namespace).queues;
	// Known promises for queues, used to synchronize requests and avoid races between delayed creations and modifications.
	const queuePromises = {};

	function enqueue(name, next) {
		// Enqueue the request to happen when the previous request is done.
		const previousPromise = queuePromises[name] || Promise.resolve();

		return queuePromises[name] = previousPromise.then(next);
	}

	/**
	 * Main loop
	 */
	function mainLoop() {
		// List all known queues
		queues.list().then(list => {
			const resourceVersion = list.metadata.resourceVersion;

			// Treat all queues we see as "update", which will trigger a creation/update of attributes accordingly.
			for (const queue of list.items) {
				const name = queue.metadata.name;
				enqueue(name, function() {
					logger.info(`[${name}]: Syncing`);
					return updateQueue(queue);
				}).then(function(data) {
					logger.info(`[${name}]: ${JSON.stringify(data)}`);
				}, function(err) {
					logger.error(`[${name}]: ${err.message} (${err.code})`);
				});
			}

			// Start watching the queues from that version on
			logger.info(`Watching queues at ${resourceVersion}...`);
			queues.watch(resourceVersion)
				.on('data', function(item) {
					const queue = item.object;
					const name = queue.metadata.name;

					let next;

					switch (item.type) {
					case 'ADDED':
						next = function() {
							logger.info(`[${name}]: Creating queue`);
							return createQueue(queue);
						};
						break;
					case 'MODIFIED':
						next = function() {
							logger.info(`[${name}]: Updating queue attributes`);
							return updateQueue(queue);
						};
						break;
					case 'DELETED':
						next = function() {
							logger.info(`[${name}]: Deleting queue`);
							return deleteQueue(queue);
						};
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

					// Note that we retain the 'rejected' state here: an existing queue that ended in a rejection
					// will effectively stay rejected.
					const result = enqueue(name, next).then(function(data) {
						logger.info(`[${name}]: ${JSON.stringify(data)}`);
					}, function(err) {
						logger.error(`[${name}]: ${err.message} (${err.code})`);
					});

					return result;
				})
				.on('end', function() {
					// Restart the watch from the last known version.
					logger.info('Watch ended, restarting');
					return mainLoop();
				});
		});
	}

	// Start!
	mainLoop();
}).catch(function(err) {
	logger.error(`Uncaught error, aborting: ${err.message}`);
	process.exit(1);
});
