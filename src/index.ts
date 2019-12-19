// tslint:disable-next-line no-var-requires
const k8s = require('auto-kubernetes-client');
import express from 'express';
import http from 'http';
import { getLogger } from 'log4js';
import { AddressInfo } from 'net';
import yargs from 'yargs';

import { initMonitoring } from './monitoring';
import { PromisesQueue } from './promises-queue';
import { IAMRole } from './resources/iam/iam';
import { S3Bucket } from './resources/s3/s3';
import { SQSQueue } from './resources/sqs/sqs';

import pkg from '../package.json';
import { createK8sConfig } from './k8-config';
import { ResourceClient } from './resources/client';

const logger = getLogger();

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

const sqsClientOptions = {
	endpoint: process.env.AWS_SQS_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
};
// NB: IAM is region-less, so we need to be able to control the region used independently from the other resources
const iamClientOptions = {
	endpoint: process.env.AWS_IAM_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_IAM_REGION || 'us-east-1',
};
const s3ClientOptions = {
	endpoint: process.env.AWS_S3_ENDPOINT_URL_OVERRIDE,
	region: process.env.AWS_REGION,
};

// Set up the express server for /metrics
const app = express();
app.use(initMonitoring());

/**
 * Log whether the given promise resolved successfully or not.
 *
 * @param name the name of the entity that the promise actually modifies
 * @param promise a promise
 * @return the same promise with added logging
 */
function logOperationResult(name: string, promise: Promise<any>): Promise<any> {
	return promise.then(data => {
		logger.info(`[${name}]: Success ${JSON.stringify(data)}`);
		return data;
	}, err => {
		logger.error(`[${name}]: Error ${err.message} (${err.code})`);
		throw err;
	});
}

const server = http.createServer(app);
const listener = server.listen(argv.port, async () => {
	const k8sConfig = createK8sConfig(argv);
	try {
		const k8sClient = await k8s(k8sConfig);
		const resourceDescriptions = [
			{
				resourceClient: new SQSQueue(sqsClientOptions),
				type: 'queues',
			}, {
				resourceClient: new IAMRole(iamClientOptions),
				type: 'roles',
			}, {
				resourceClient: new S3Bucket(s3ClientOptions),
				type: 'buckets',
			},
		].filter(resourceDescription => {
			const resourceType: string = argv.resourceType as string;
			return resourceType.length === 0 || resourceType.indexOf(resourceDescription.type) !== -1;
		});
		logger.debug(`Enabled resource types: ${resourceDescriptions.map(resourceDescription => resourceDescription.type)}`);

		async function resourceLoop(type: string, resourceK8sClient: any, resourceClient: ResourceClient<any>, promisesQueue: PromisesQueue) {
			const list = await resourceK8sClient.list();
			const resourceVersion = list.metadata.resourceVersion;

			// Treat all resources we see as "update", which will trigger a creation/update of attributes accordingly.
			for (const resource of list.items) {
				const name = resource.metadata.name;
				logOperationResult(name, promisesQueue.enqueue(name, () => {
					logger.info(`[${name}]: Syncing`);
					return resourceClient.update(resource);
				}));
			}

			// Start watching the resources from that version on
			logger.info(`Watching ${type} at ${resourceVersion}...`);
			resourceK8sClient.watch(resourceVersion)
				.on('data', (item: any) => {
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
		const addressInfo: AddressInfo = listener.address()! as AddressInfo;
		logger.info(`${pkg.name} ${pkg.version} ready on port ${addressInfo.port}`);

		return Promise.all(resourceLoopPromises);
	} catch (err) {
		logger.error(`Uncaught error, aborting: ${err.message}`);
		process.exit(1);
	}
});
