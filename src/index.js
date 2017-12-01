#!/usr/bin/env node

'use strict';

const yargs = require('yargs');
const fs = require('fs');
const path = require('path');

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

const sqsClientOptions = {
	endpoint: process.env.AWS_SQS_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
};

const SQSQueue = require('./resources/sqs');

const k8sConfig = createK8sConfig(argv);
k8s(k8sConfig).then(function onConnected(k8sClient) {
	const awsResourcesClient = k8sClient.group('aws.k8s.collaborne.com', 'v1').ns(argv.namespace);

	const resourceDescriptions = [{
		type: 'queues',
		resourceClient: new SQSQueue(sqsClientOptions)
	}];

	/**
	 * Known promises for queues, used to synchronize requests and avoid races between delayed creations and modifications.
	 *
	 * @type {Object.<string,Promise<any>>}
	 */
	const queuePromises = {};

	function enqueue(name, next) {
		// Enqueue the request to happen when the previous request is done.
		const previousPromise = queuePromises[name] || Promise.resolve();

		return queuePromises[name] = previousPromise.then(next);
	}

	function resourceLoop(type, k8sResourceClient, resourceClient) {
		k8sResourceClient.list()
			.then(list => {
				const resourceVersion = list.metadata.resourceVersion;

				// Treat all resources we see as "update", which will trigger a creation/update of attributes accordingly.
				for (const resource of list.items) {
					const name = resource.metadata.name;
					enqueue(name, function() {
						logger.info(`[${name}]: Syncing`);
						return resourceClient.update(resource);
					}).then(function(data) {
						logger.info(`[${name}]: ${JSON.stringify(data)}`);
					}, function(err) {
						logger.error(`[${name}]: ${err.message} (${err.code})`);
					});
				}

				return resourceVersion;
			}).then(resourceVersion => {
				// Start watching the resources from that version on
				logger.info(`Watching ${type} at ${resourceVersion}...`);
				k8sResourceClient.watch(resourceVersion)
					.on('data', function(item) {
						const resource = item.object;
						const name = resource.metadata.name;

						let next;

						switch (item.type) {
						case 'ADDED':
							next = function() {
								logger.info(`[${name}]: Creating resource`);
								return resourceClient.create(resource);
							};
							break;
						case 'MODIFIED':
							next = function() {
								logger.info(`[${name}]: Updating resource attributes`);
								return resourceClient.update(resource);
							};
							break;
						case 'DELETED':
							next = function() {
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
						return resourceLoop(type, k8sResourceClient, resourceClient);
					});
			})
	}

	resourceDescriptions.forEach(resourceDescription => {
		const k8sResourceClient = awsResourcesClient[resourceDescription.type];
		if (k8sResourceClient) {
			resourceLoop(resourceDescription.type, resourceDescription.k8sResourceClient, resourceDescription.resourceClient);
		} else {
			console.error(`Resources of type ${resourceDescription.type} are not defined as Kubernetes ThirdPartyResource. Available ThirdPartyResources ${Object.keys(awsResourcesClient)}.`);
		}
	});
}).catch(function(err) {
	logger.error(`Uncaught error, aborting: ${err.message}`);
	process.exit(1);
});
