#!/usr/bin/env node

'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');

const k8s = require('auto-kubernetes-client');

const http = require('http');
const express = require('express');

const monitoring = require('./monitoring');

const pkg = require('../package.json');

const logger = require('log4js').getLogger();

const argv = yargs
	.alias('s', 'server').describe('server', 'The address and port of the Kubernetes API server')
	.alias('cacert', 'certificate-authority').describe('certificate-authority', 'Path to a cert. file for the certificate authority')
	.alias('cert', 'client-certificate').describe('client-certificate', 'Path to a client certificate file for TLS')
	.alias('key', 'client-key').describe('client-key', 'Path to a client key file for TLS')
	.boolean('insecure-skip-tls-verify').describe('insecure-skip-tls-verify', 'If true, the server\'s certificate will not be checked for validity. This will make your HTTPS connections insecure')
	.describe('token', 'Bearer token for authentication to the API server')
	.describe('namespace', 'The namespace to watch').demandOption('namespace')
	.array('resource-type').describe('resource-type', 'Enabled resource types (empty to enable all, can use multiple times)').default('resource-type', [])
	.number('port').default('port', process.env.PORT || 8080)
	.help()
	.argv;

/**
 * Creates basic configuration for accessing the Kubernetes API server
 *
 * @param {Object} args Command line arguments
 * @returns {Object} Kubernetes client configuration
 */
function createK8sConfig(args) {
	function createK8sConfigWithServer({server, insecureSkipTlsVerify, certificateAuthority, token, username, password, clientCertificate, clientKey}) {
		const k8sConfig = {
			insecureSkipTlsVerify: insecureSkipTlsVerify,
			url: server,
		};
		if (certificateAuthority) {
			k8sConfig.ca = fs.readFileSync(certificateAuthority, 'utf8');
		}
		if (token) {
			k8sConfig.auth = {
				bearer: token
			};
		} else if (username && password) {
			k8sConfig.auth = {
				pass: password,
				user: username,
			};
		} else if (clientCertificate && clientKey) {
			k8sConfig.cert = fs.readFileSync(clientCertificate, 'utf8');
			k8sConfig.key = fs.readFileSync(clientKey, 'utf8');
		}

		return k8sConfig;
	}

	function createK8sConfigFromEnvironment(env) {
		// Runs in Kubernetes
		const credentialsPath = '/var/run/secrets/kubernetes.io/serviceaccount/';
		return {
			auth: {
				bearer: fs.readFileSync(path.resolve(credentialsPath, 'token'), 'utf8')
			},
			ca: fs.readFileSync(path.resolve(credentialsPath, 'ca.crt'), 'utf8'),
			url: `https://${env.KUBERNETES_SERVICE_HOST}:${env.KUBERNETES_SERVICE_PORT}`,
		};
	}

	let k8sConfig;
	if (args.server) {
		// For local development
		k8sConfig = createK8sConfigWithServer(args);
	} else if (process.env.KUBERNETES_SERVICE_HOST) {
		k8sConfig = createK8sConfigFromEnvironment(process.env);
	} else {
		throw new Error('Unknown Kubernetes API server');
	}

	return k8sConfig;
}

const sqsClientOptions = {
	endpoint: process.env.AWS_SQS_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
};
const iamClientOptions = {
	endpoint: process.env.AWS_IAM_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION
};

const SQSQueue = require('./resources/sqs');
const IAMRole = require('./resources/iam');
const PromisesQueue = require('./promises-queue');

// Set up the express server for /metrics
const app = express();
app.use(monitoring());

/**
 * Log whether the given promise resolved successfully or not.
 *
 * @param {string} name the name of the entity that the promise actually modifies
 * @param {Promise<any>} promise a promise
 * @return {Promise<any>} the same promise with added logging
 */
function logOperationResult(name, promise) {
	return promise.then(data => {
		logger.info(`[${name}]: Success ${JSON.stringify(data)}`);
		return data;
	}, err => {
		logger.error(`[${name}]: Error ${err.message} (${err.code})`);
		throw err;
	});
}

const server = http.createServer(app);
const listener = server.listen(argv.port, () => {
	const k8sConfig = createK8sConfig(argv);
	k8s(k8sConfig).then(k8sClient => {
		const resourceDescriptions = [
			{
				resourceClient: new SQSQueue(sqsClientOptions),
				type: 'queues',
			}, {
				resourceClient: new IAMRole(iamClientOptions),
				type: 'roles',
			}
		].filter(resourceDescription => argv.resourceType.length === 0 || argv.resourceType.indexOf(resourceDescription.type) !== -1);
		logger.debug(`Enabled resource types: ${resourceDescriptions.map(resourceDescription => resourceDescription.type)}`);

		function resourceLoop(type, resourceK8sClient, resourceClient, promisesQueue) { // eslint-disable-line max-params
			return resourceK8sClient.list()
				.then(list => {
					const resourceVersion = list.metadata.resourceVersion;

					// Treat all resources we see as "update", which will trigger a creation/update of attributes accordingly.
					for (const resource of list.items) {
						const name = resource.metadata.name;
						logOperationResult(name, promisesQueue.enqueue(name, () => {
							logger.info(`[${name}]: Syncing`);
							return resourceClient.update(resource);
						}));
					}

					return resourceVersion;
				}).then(resourceVersion => {
					// Start watching the resources from that version on
					logger.info(`Watching ${type} at ${resourceVersion}...`);
					resourceK8sClient.watch(resourceVersion)
						.on('data', item => {
							const resource = item.object;
							const name = resource.metadata.name;

							let next;

							switch (item.type) {
							case 'ADDED':
								next = function createResource() {
									logger.info(`[${name}]: Creating resource`);
									return resourceClient.create(resource);
								};
								break;
							case 'MODIFIED':
								next = function updateResource() {
									logger.info(`[${name}]: Updating resource attributes`);
									return resourceClient.update(resource);
								};
								break;
							case 'DELETED':
								next = function deleteResource() {
									logger.info(`[${name}]: Deleting resource`);
									return resourceClient.delete(resource);
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

							// Note that we retain the 'rejected' state here: an existing resource that ended in a rejection
							// will effectively stay rejected.
							logOperationResult(name, promisesQueue.enqueue(name, next));
						})
						.on('end', () => {
							// Restart the watch from the last known version.
							logger.info(`Watch of ${type} ended, restarting`);
							resourceLoop(type, resourceK8sClient, resourceClient, promisesQueue);
						});
				});
		}

		const resourceLoopPromises = resourceDescriptions.map(resourceDescription => {
			const awsResourcesK8sClient = k8sClient.group('aws.k8s.collaborne.com', 'v1').ns(argv.namespace);
			const resourceK8sClient = awsResourcesK8sClient[resourceDescription.type];
			if (!resourceK8sClient) {
				// XXX: Is this a failure?
				logger.error(`Cannot create client for resources of type ${resourceDescription.type}: Available resources: ${Object.keys(awsResourcesK8sClient)}.`);
				return Promise.reject(new Error(`Missing kubernetes client for ${resourceDescription.type}`));
			}

			const promisesQueue = new PromisesQueue();
			return resourceLoop(resourceDescription.type, resourceK8sClient, resourceDescription.resourceClient, promisesQueue).catch(err => {
				logger.error(`Error when monitoring resources of type ${resourceDescription.type}: ${err.message}`);
				throw err;
			});
		});

		// XXX: The promises now all start, but technically they might fail quickly if something goes wrong.
		//      For the purposes of logging things though we're "ready" now.
		logger.info(`${pkg.name} ${pkg.version} ready on port ${listener.address().port}`);

		return Promise.all(resourceLoopPromises);
	}).catch(err => {
		logger.error(`Uncaught error, aborting: ${err.message}`);
		process.exit(1);
	});
});
