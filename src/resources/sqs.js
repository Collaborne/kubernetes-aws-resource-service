const AWS = require('aws-sdk');

const {capitalize, capitalizeFieldNames, delay, isTransientNetworkError} = require('./utils');

const logger = require('log4js').getLogger('SQSQueue');

/**
 * A queue resource in Kubernetes
 *
 * @typedef Queue
 * @property {KubernetesMetadata} metadata
 * @property {QueueSpec} spec
 * @property {QueueStatus} status
 */

/**
 * Kubernetes resource metadata
 *
 * @typedef KubernetesMetadata
 * @property {String} namespace
 * @property {String} name
 * @property {Object.<String,String>} labels
 * @property {Object.<String,String>} metadata
 */

/**
 * A queue specification
 *
 * @typedef QueueSpec
 * @property {Object} [redrivePolicy]
 * @property {Object} [policy]
 */

/**
 * A adapter for modifying AWS SQS queues using Queue definitions
 */
class SQSQueue { // eslint-disable-line padded-blocks
	/**
	 *
	 * @param {Object} [options] SQS client options
	 */
	constructor(options = {}) {
		this.sqs = new AWS.SQS(options);
	}

	/**
	 * Inject the queue ARN as 'Resource' into all statements of the policy
	 *
	 * @param {String} queueName name of the queue
	 * @param {Object} policy a policy
	 * @param {String} [queueArn] a queue ARN to attempt to inject
	 * @return {Object} the policy, with the ARN injected if possible
	 */
	_injectQueueArn(queueName, policy, queueArn) {
		if (!queueArn) {
			return policy;
		}

		logger.debug(`[${queueName}]: Injecting resource ARN ${queueArn} into policy document`);
		const newStatement = (policy.Statement || []).map(statement => Object.assign({Resource: queueArn}, statement));
		return Object.assign({}, policy, {
			Statement: newStatement
		});
	}

	/**
	 * Convert the queue.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Queue} queue a queue definition
	 * @param {String} [queueArn] the ARN of the queue
	 * @return {Object} the queue attributes
	 */
	_translateAttributes(queue, queueArn) {
		return Object.keys(queue.spec || {}).reduce((result, key) => {
			const value = queue.spec[key];
			let resultValue;
			switch (key) {
			case 'redrivePolicy':
				resultValue = JSON.stringify(capitalizeFieldNames(value));
				break;
			case 'policy':
				resultValue = JSON.stringify(this._injectQueueArn(queue.metadata.name, capitalizeFieldNames(value), queueArn));
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

	// XXX: logName could be awsOperation.name, except that that is empty for AWS?
	_retryOnTransientNetworkErrors(logName, awsOperation, awsArguments) {
		const errorRetryDelay = 30000;
		return awsOperation.apply(this.sqs, awsArguments).promise()
			.catch(err => {
				if (isTransientNetworkError(err)) {
					logger.warn(`[${logName}]: transient ${err.code} ${err.errno}, retrying in ${errorRetryDelay / 1000}s`);
					return delay(errorRetryDelay).then(() => this._retryOnTransientNetworkErrors(logName, awsOperation, awsArguments));
				}

				logger.warn(`[${logName}]: non-retryable error in operation: ${err.message}`);
				throw err;
			});
	}

	_reportError(logName, err, description) {
		logger.warn(`[${logName}]: ${description}: ${err.message}`);
		throw new Error(`${description}: ${err.message}`);
	}

	_createQueue(queueName, attributes) {
		const request = {
			Attributes: attributes,
			QueueName: queueName
		};
		return this._retryOnTransientNetworkErrors('SQS::CreateQueue', this.sqs.createQueue, [request])
			.catch(err => this._reportError(queueName, err, 'Cannot create queue'));
	}

	_deleteQueue(queueName, queueUrl) {
		const request = {
			QueueUrl: queueUrl
		};
		return this._retryOnTransientNetworkErrors('SQS::DeleteQueue', this.sqs.deleteQueue, [request])
			.catch(err => this._reportError(queueName, err, 'Cannot delete queue'));
	}

	_getQueueUrl(queueName) {
		const request = {
			QueueName: queueName
		};
		return this._retryOnTransientNetworkErrors('SQS::GetQueueUrl', this.sqs.getQueueUrl, [request])
			.catch(err => this._reportError(queueName, err, 'Cannot get queue url'));
	}

	_getQueueAttributes(queueName, queueUrl, attributeNames) {
		const request = {
			AttributeNames: attributeNames,
			QueueUrl: queueUrl
		};
		return this._retryOnTransientNetworkErrors('SQS::GetQueueAttributes', this.sqs.getQueueAttributes, [request])
			.catch(err => this._reportError(queueName, err, 'Cannot get queue attributes'));
	}

	_setQueueAttributes(queueName, queueUrl, attributes) {
		const request = {
			Attributes: attributes,
			QueueUrl: queueUrl
		};
		return this._retryOnTransientNetworkErrors('SQS::SetQueueAttributes', this.sqs.setQueueAttributes, [request])
			.catch(err => this._reportError(queueName, err, 'Cannot set queue attributes'));
	}

	/**
	 * Create a new queue
	 *
	 * @param {Queue} queue Queue definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the queue is created
	 */
	create(queue) {
		const attributes = this._translateAttributes(queue);
		return this._createQueue(queue.metadata.name, attributes)
			.catch(err => {
				if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
					const retryDelay = 30000;
					logger.info(`[${queue.metadata.name}]: Queue recently deleted, retrying creation in ${retryDelay / 1000}s`);
					return delay(retryDelay).then(() => this.create(queue));
				}

				throw err;
			});
	}

	/**
	 * Updates SQS queue
	 *
	 * @param {Queue} queue Queue definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the queue is updated
	 */
	update(queue) {
		const queueName = queue.metadata.name;
		return this._getQueueUrl(queueName)
			.catch(err => {
				if (err.name === 'AWS.SimpleQueueService.NonExistentQueue') {
					// Queue doesn't exist: this means kubernetes saw an update, but in fact the queue was never created,
					// or has been deleted in the meantime. Create it again.
					logger.info(`[${queueName}]: Queue does not/no longer exist, re-creating it`);
					return this._createQueue(queue);
				}

				throw err;
			})
			.then(response => {
				const queueUrl = response.QueueUrl;
				return this._getQueueAttributes(queueName, queueUrl, ['QueueArn'])
					.then(attributesResponse => {
						const attributes = this._translateAttributes(queue, attributesResponse.Attributes.QueueArn);
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

						return this._setQueueAttributes(queueName, queueUrl, attributes);
					});
			});
	}

	/**
	 * Delete SQS queue
	 *
	 * @param {Queue} queue Queue definition in Kubernetes
	 * @return {Promise<any>} a promise that resolves when the queue was deleted
	 */
	delete(queue) {
		const queueName = queue.metadata.name;
		return this._getQueueUrl(queueName)
			.then(response => {
				return this._deleteQueue(queueName, response.QueueUrl);
			});
	}
}

module.exports = SQSQueue;
