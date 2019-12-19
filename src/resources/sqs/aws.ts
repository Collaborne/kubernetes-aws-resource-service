import { SQS } from 'aws-sdk';
import { getLogger } from 'log4js';

import { retryOnTransientNetworkErrors } from '../utils';

const logger = getLogger('SQSQueue');

/**
 * Client to connect to AWS SQS
 */
export class SQSClient {
	private sqs: SQS;

	/**
	 *
	 * @param {Object} [options] SQS client options
	 */
	constructor(options: SQS.Types.ClientConfiguration = {}) {
		this.sqs = new SQS(options);
	}

	public createQueue(queueName: string, attributes: {[key: string]: string}) {
		const request = {
			Attributes: attributes,
			QueueName: queueName,
		};
		return retryOnTransientNetworkErrors(`${queueName} - SQS::CreateQueue`, () => this.sqs.createQueue(request));
	}

	public deleteQueue(queueName: string, queueUrl: string) {
		const request = {
			QueueUrl: queueUrl,
		};
		return retryOnTransientNetworkErrors(`${queueName} - SQS::DeleteQueue`, () => this.sqs.deleteQueue(request));
	}

	public async getQueueUrl(queueName: string): Promise<string> {
		const request = {
			QueueName: queueName,
		};
		const response = await retryOnTransientNetworkErrors(`${queueName} - SQS::GetQueueUrl`, () => this.sqs.getQueueUrl(request));
		if (!response.QueueUrl) {
			const err = new Error(`Cannot get queue URL for queue ${queueName}: ${JSON.stringify(response)}`);
			logger.warn(`[${queueName}]: ${err.message}`);
			throw response;
		}
		return response.QueueUrl;
	}

	public async getQueueAttributes(queueName: string, queueUrl: string, attributeNames: string[]): Promise<{[key: string]: string}> {
		const request = {
			AttributeNames: attributeNames,
			QueueUrl: queueUrl,
		};
		const response = await retryOnTransientNetworkErrors(`${queueName} - SQS::GetQueueAttributes`, () => this.sqs.getQueueAttributes(request));
		if (!response.Attributes) {
			const err = new Error(`Can't get queue attributes for ${queueUrl}: ${JSON.stringify(response)}`);
			logger.warn(`[${queueName}]: ${err.message}`);
			throw response;
		}
		return response.Attributes;
	}

	public setQueueAttributes(queueName: string, queueUrl: string, attributes: {[key: string]: string}) {
		const request = {
			Attributes: attributes,
			QueueUrl: queueUrl,
		};
		retryOnTransientNetworkErrors(`${queueName} - SQS::SetQueueAttributes`, () => this.sqs.setQueueAttributes(request));
	}
}
