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
		this.sqs = new AWS.SQS(Object.assign({}, options));
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

		logger.debug(`[${queueName}]: Injecting resource ARN ${queueArn} into policy document`)
		return Object.assign({}, policy, { Statement: (policy.Statement || []).map(statement => Object.assign({Resource: queueArn}, statement)) });
	}

	/**
	 * Convert the queue.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Queue} queue a queue definition
	 * @param {String} [queueArn] the ARN of the queue
	 * @return {Object} the queue attributes
	 */
	translateQueueAttributes(queue, queueArn) {
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

	/**
	 * Resolve a promise using the given `resolve` after the `timeout` has passed by retrying `operation` on `queue`.
	 *
	 * @param {Function} resolve
	 * @param {Function} operation
	 * @param {Number} after
	 * @param {Queue} queue
	 */
	resolveRetry(resolve, operation, after, queue, cause) {
		logger.warn(`[${queue.metadata.name}]: ${cause}, retrying in ${after/1000}s`);
		return delay(after).then(() => resolve(operation(queue)));
	}

	/**
	 *
	 * @param {Queue} queue Queue definition in Kubernetes
	 */
	create(queue) {
		const self = this;
		return new Promise(function(resolve, reject) {
			const attributes = self.translateQueueAttributes(queue);
			return self.sqs.createQueue({ QueueName: queue.metadata.name, Attributes: attributes }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
						return self.resolveRetry(resolve, self.create.bind(self), 10000, queue, 'queue recently deleted');
					} else if (isTransientNetworkError(err)) {
						return self.resolveRetry(resolve, self.create.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot create queue: ${err.message}`);
					return reject(err);
				}

				return resolve(data);
			});
		});
	}

	/**
	 * Updates SQS queue
	 * @param {Queue} queue Queue definition in Kubernetes
	 */
	update(queue) {
		const self = this;
		return new Promise(function(resolve, reject) {
			return self.sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.NonExistentQueue') {
						// Queue doesn't exist: this means kubernetes saw an update, but in fact the queue was never created,
						// or has been deleted in the meantime. Create it again.
						logger.info(`[${queue.metadata.name}]: Queue does not/no longer exist, re-creating it`);
						return resolve(self.create(queue));
					} else if (isTransientNetworkError(err)) {
						return self.resolveRetry(resolve, self.update.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				const queueUrl = data.QueueUrl;
				return self.sqs.getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: [ 'QueueArn' ] }, function(err, data) {
					if (err) {
						if (isTransientNetworkError(err)) {
							return self.resolveRetry(resolve, self.update.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
						}

						logger.warn(`[${queue.metadata.name}]: Cannot determine queue ARN: ${err.message}`);
						return reject(err);
					}

					const attributes = self.translateQueueAttributes(queue, data.Attributes.QueueArn);
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


					return self.sqs.setQueueAttributes({ QueueUrl: queueUrl, Attributes: attributes }, function(err, data) {
						if (err) {
							if (isTransientNetworkError(err)) {
								return self.resolveRetry(resolve, self.update.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
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

	/**
	 * Delete SQS queue
	 *
	 * @param {Queue} queue Queue definition in Kubernetes
	 */
	delete(queue) {
		const self = this;
		return new Promise(function(resolve, reject) {
			return self.sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					if (isTransientNetworkError(err)) {
						return self.resolveRetry(resolve, self.delete.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				return self.sqs.deleteQueue({ QueueUrl: data.QueueUrl }, function(err, data) {
					if (err) {
						if (isTransientNetworkError(err)) {
							return self.resolveRetry(resolve, self.delete.bind(self), 30000, queue, `transient ${err.code} ${err.errno}`);
						}

						logger.warn(`[${queue.metadata.name}]: Cannot delete queue: ${err.message}`);
						return reject(err);
					}

					return resolve(data);
				});
			});
		});
	}
}

module.exports = SQSQueue;
