const AWS = require('aws-sdk');

const logger = require('log4js').getLogger('SQSQueue');

class SQSQueue {
	/**
	 *
	 * @param {Object} SQS client options
	 */
	constructor(options) {
		this.sqs = new AWS.SQS(Object.assign({}, options));
	}

	/**
	 * Convert the queue.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Object} queue a queue definition
	 * @param {String} [queueArn] the ARN of the queue
	 * @return {Object} the queue attributes
	 */
	translateQueueAttributes(queue, queueArn) {
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
	isTransientNetworkError(err) {
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
	resolveRetry(resolve, operation, after, queue, cause) {
		logger.warn(`[${queue.metadata.name}]: ${cause}, retrying in ${after/1000}s`);
		return setTimeout(function() {
			return resolve(operation(queue));
		}, after);
	}

	/**
	 *
	 * @param {Object} queue Queue definition in Kubernetes
	 */
	create(queue) {
		return new Promise(function(resolve, reject) {
			const attributes = this.translateQueueAttributes(queue);
			return this.sqs.createQueue({ QueueName: queue.metadata.name, Attributes: attributes }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.QueueDeletedRecently') {
						return this.resolveRetry(resolve, this.create, 10000, queue, 'queue recently deleted');
					} else if (this.isTransientNetworkError(err)) {
						return this.resolveRetry(resolve, this.create, 30000, queue, `transient ${err.code} ${err.errno}`);
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
	 * @param {Object} queue Queue definition in Kubernetes
	 */
	update(queue) {
		return new Promise(function(resolve, reject) {
			return this.sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					if (err.name === 'AWS.SimpleQueueService.NonExistentQueue') {
						// Queue doesn't exist: this means kubernetes saw an update, but in fact the queue was never created,
						// or has been deleted in the meantime. Create it again.
						logger.info(`[${queue.metadata.name}]: Queue does not/no longer exist, re-creating it`);
						return resolve(this.create(queue));
					} else if (this.isTransientNetworkError(err)) {
						return this.resolveRetry(resolve, this.update, 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				const queueUrl = data.QueueUrl;
				return this.sqs.getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: [ 'QueueArn' ] }, function(err, data) {
					if (err) {
						if (this.isTransientNetworkError(err)) {
							return this.resolveRetry(resolve, this.update, 30000, queue, `transient ${err.code} ${err.errno}`);
						}

						logger.warn(`[${queue.metadata.name}]: Cannot determine queue ARN: ${err.message}`);
						return reject(err);
					}

					const attributes = this.translateQueueAttributes(queue, data.Attributes.QueueArn);
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


					return this.sqs.setQueueAttributes({ QueueUrl: queueUrl, Attributes: attributes }, function(err, data) {
						if (err) {
							if (this.isTransientNetworkError(err)) {
								return this.resolveRetry(resolve, this.update, 30000, queue, `transient ${err.code} ${err.errno}`);
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
	 * @param {Object} queue Queue definition in Kubernetes
	 */
	delete(queue) {
		return new Promise(function(resolve, reject) {
			return this.sqs.getQueueUrl({ QueueName: queue.metadata.name }, function(err, data) {
				if (err) {
					if (this.isTransientNetworkError(err)) {
						return this.resolveRetry(resolve, this.delete, 30000, queue, `transient ${err.code} ${err.errno}`);
					}

					logger.warn(`[${queue.metadata.name}]: Cannot determine queue URL: ${err.message}`);
					return reject(err);
				}

				return this.sqs.deleteQueue({ QueueUrl: data.QueueUrl }, function(err, data) {
					if (err) {
						if (this.isTransientNetworkError(err)) {
							return this.resolveRetry(resolve, this.delete, 30000, queue, `transient ${err.code} ${err.errno}`);
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
