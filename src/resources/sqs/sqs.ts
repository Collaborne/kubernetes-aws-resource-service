import { SQS } from 'aws-sdk';
import { getLogger } from 'log4js';

import { ResourceClient } from '../client';
import { delay } from '../utils';
import { SQSClient } from './aws';
import { KubernetesQueue } from './kubernetes-config';
import { translateAttributes } from './kubernetes-to-aws';

const logger = getLogger('SQSQueue');

/**
 * A adapter for modifying AWS SQS queues using Queue definitions
 */
export class SQSQueue implements ResourceClient<KubernetesQueue> {
	private sqsClient: SQSClient;

	/**
	 *
	 * @param {Object} [options] SQS client options
	 */
	constructor(options: SQS.Types.ClientConfiguration = {}) {
		this.sqsClient = new SQSClient(options);
	}

	/**
	 * Create a new queue
	 *
	 * @param queue Queue definition in Kubernetes
	 * @return promise that resolves when the queue is created
	 */
	public async create(queue: KubernetesQueue): Promise<any> {
		const attributes = translateAttributes(queue);
		try {
			return this.sqsClient.createQueue(queue.metadata.name, attributes);
		} catch (err) {
			if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
				const retryDelay = 30000;
				logger.info(`[${queue.metadata.name}]: Queue recently deleted, retrying creation in ${retryDelay / 1000}s`);
				await delay(retryDelay);
				return this.create(queue);
			}

			throw err;
		}
	}

	/**
	 * Updates SQS queue
	 *
	 * @param queue Queue definition in Kubernetes
	 * @return promise that resolves when the queue is updated
	 */
	public async update(queue: KubernetesQueue): Promise<any> {
		const queueName = queue.metadata.name;
		try {
			const queueUrl = await this.sqsClient.getQueueUrl(queueName);
			const queueAttributes = await this.sqsClient.getQueueAttributes(queueName, queueUrl, ['QueueArn']);
			const attributes = translateAttributes(queue, queueAttributes.QueueArn);
			if (Object.keys(attributes).length === 0) {
				// The API requires that we provide attributes when trying to update attributes.
				// If the caller intended to set values to their defaults, then they must be explicit and
				// provide these values. In other words: AWS SQS copies the defaults at creation time, and
				// afterwards there is no such thing as a "default" anymore.
				// From our side though this is not an error, but we merely ignore the request.
				// See also a similar change in Apache Camel: https://issues.apache.org/jira/browse/CAMEL-5782
				logger.warn(`[${queueName}]: Ignoring update without attributes`);
				return Promise.resolve({});
			}

			return this.sqsClient.setQueueAttributes(queueName, queueUrl, attributes);
		} catch (err) {
			if (err.name === 'AWS.SimpleQueueService.NonExistentQueue') {
				// Queue doesn't exist: this means kubernetes saw an update, but in fact the queue was never created,
				// or has been deleted in the meantime. Create it again.
				logger.info(`[${queueName}]: Queue does not/no longer exist, re-creating it`);
				return this.create(queue);
			}

			throw err;
		}
	}

	/**
	 * Delete SQS queue
	 *
	 * @param queue Queue definition in Kubernetes
	 * @return a promise that resolves when the queue was deleted
	 */
	public async delete(queue: KubernetesQueue): Promise<any> {
		const queueName = queue.metadata.name;
		const queueUrl = await this.sqsClient.getQueueUrl(queueName);
		return this.sqsClient.deleteQueue(queueName, queueUrl);
	}
}
