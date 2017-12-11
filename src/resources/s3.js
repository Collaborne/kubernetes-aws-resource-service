const AWS = require('aws-sdk');

const {capitalize, capitalizeFieldNames, delay, isTransientNetworkError} = require('./utils');

const logger = require('log4js').getLogger('S3');

/**
 * A bucket resource in Kubernetes
 *
 * @typedef Bucket
 * @property {KubernetesMetadata} metadata
 * @property {BucketSpec} spec
 * @property {BucketStatus} [status]
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
 * A bucket specification
 *
 * @see http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket.html
 *
 * @typedef BucketSpec
 */

/**
 * A adapter for modifying AWS S3 buckets using Bucket definitions
 */
class S3Bucket { // eslint-disable-line padded-blocks
	/**
	 *
	 * @param {Object} [options] S3 client options
	 */
	constructor(options = {}) {
		this.s3 = new AWS.S3(options);
	}

	/**
	 * Convert the bucket.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Bucket} bucket a bucket definition
	 * @return {Object} the bucket attributes
	 */
	_translateAttributes(bucket) {
		return Object.keys(bucket.spec || {}).reduce((result, key) => {
			const value = bucket.spec[key];
			let resultKey;
			switch (key) {
			case 'acl':
				resultKey = key.toUpperCase();
				break;
			default:
				resultKey = capitalize(key);
				break;
			}
			// Convert to string
			const resultValue = capitalizeFieldNames(value);
			logger.debug(`[${bucket.metadata.name}]: Attribute ${key} = ${resultValue}`);

			result[resultKey] = resultValue;
			return result;
		}, {});
	}

	// XXX: logName could be awsOperation.name, except that that is empty for AWS?
	_retryOnTransientNetworkErrors(logName, awsOperation, awsArguments) {
		const errorRetryDelay = 30000;
		return awsOperation.apply(this.s3, awsArguments).promise()
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
		throw err;
	}

	_createBucket(bucketName, attributes) {
		const request = Object.assign({}, attributes, {
			Bucket: bucketName
		});
		return this._retryOnTransientNetworkErrors('S3::CreateBucket', this.s3.createBucket, [request])
			.catch(err => this._reportError(bucketName, err, 'Cannot create bucket'));
	}

	_deleteBucket(bucketName) {
		const request = {
			Bucket: bucketName
		};
		return this._retryOnTransientNetworkErrors('S3::DeleteBucket', this.s3.deleteBucket, [request])
			.catch(err => this._reportError(bucketName, err, 'Cannot delete bucket'));
	}

	_headBucket(bucketName) {
		const request = {
			Bucket: bucketName
		};
		return this._retryOnTransientNetworkErrors('S3::HeadBucket', this.s3.headBucket, [request])
			.catch(err => this._reportError(bucketName, err, 'Cannot head bucket'));
	}

	/**
	 * Create a new bucket
	 *
	 * @param {Bucket} bucket Bucket definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the bucket is created
	 */
	create(bucket) {
		const attributes = this._translateAttributes(bucket);
		return this._createBucket(bucket.metadata.name, attributes);
	}

	/**
	 * Updates S3 bucket
	 *
	 * Creates a new bucket if it doesn't exists. Otherwise updates cause an error message.
	 *
	 * @param {Bucket} bucket Bucket definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the bucket is updated
	 */
	update(bucket) {
		const bucketName = bucket.metadata.name;
		return this._headBucket(bucketName)
			.then(response => {
				logger.error(`[${bucketName}]: Cannot update bucket: unsupported operation`);
				return response;
			})
			.catch(err => {
				if (err.name === 'NotFound') {
					// Bucket doesn't exist: this means kubernetes saw an update, but in fact the bucket was never created,
					// or has been deleted in the meantime. Create it again.
					logger.info(`[${bucketName}]: Bucket does not/no longer exist, re-creating it`);
					return this.create(bucket);
				}

				throw err;
			});
	}

	/**
	 * Delete bucket
	 *
	 * @param {Bucket} bucket Bucket definition in Kubernetes
	 * @return {Promise<any>} a promise that resolves when the bucket was deleted
	 */
	delete(bucket) {
		return this._deleteBucket(bucket.metadata.name);
	}
}

module.exports = S3Bucket;
