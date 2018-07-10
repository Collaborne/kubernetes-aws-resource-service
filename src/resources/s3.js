const AWS = require('aws-sdk');

require('./kubernetes');
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
 * A bucket specification
 *
 * @typedef BucketSpec
 * @property {("private"|"public-read"|"public-read-write"|"aws-exec-read"|"authenticated-read"|"bucket-owner-read"|"bucket-owner-full-control"|"log-delivery-write")} [acl] The canned ACL to apply to the bucket
 * @property {CreateBucketConfiguration} [createBucketConfiguration]
 */

/**
 * @typedef CreateBucketConfiguration
 * @property {("EU"|"eu-west-1"|"us-west-1"|"us-west-2"|"ap-south-1"|"ap-southeast-1"|"ap-southeast-2"|"ap-northeast-1"|"sa-east-1"|"cn-north-1"|"eu-central-1")} locationConstraint
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
	async _retryOnTransientNetworkErrors(logName, awsOperation, awsArguments) {
		const errorRetryDelay = 30000;
		try {
			return await awsOperation.apply(this.s3, awsArguments).promise();
		} catch (err) {
			if (isTransientNetworkError(err)) {
				logger.warn(`[${logName}]: transient ${err.code} ${err.errno}, retrying in ${errorRetryDelay / 1000}s`);
				await delay(errorRetryDelay);
				return this._retryOnTransientNetworkErrors(logName, awsOperation, awsArguments);
			}

			logger.warn(`[${logName}]: non-retryable error in operation: ${err.message}`);
			throw err;
		}
	}

	_reportError(logName, err, description) {
		logger.warn(`[${logName}]: ${description}: ${err.message}`);
		throw err;
	}

	async _createBucket(bucketName, attributes) {
		if (attributes.Bucket && attributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${attributes.Bucket}`);
		}
		const request = Object.assign({}, attributes, {
			Bucket: bucketName
		});
		try {
			return await this._retryOnTransientNetworkErrors('S3::CreateBucket', this.s3.createBucket, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot create bucket');
		}
	}

	async _putBucketAcl(bucketName, aclAttributes) {
		if (aclAttributes.Bucket && aclAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${aclAttributes.Bucket}`);
		}
		const request = Object.assign({}, aclAttributes, {
			Bucket: bucketName
		});
		try {
			return await this._retryOnTransientNetworkErrors('S3::PutBucketAcl', this.s3.putBucketAcl, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot configure bucket ACL');
		}
	}

	async _deleteBucket(bucketName) {
		const request = {
			Bucket: bucketName
		};
		try {
			return await this._retryOnTransientNetworkErrors('S3::DeleteBucket', this.s3.deleteBucket, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot delete bucket');
		}
	}

	async _headBucket(bucketName) {
		const request = {
			Bucket: bucketName
		};
		try {
			return await this._retryOnTransientNetworkErrors('S3::HeadBucket', this.s3.headBucket, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot head bucket');
		}
	}

	async _getBucketLocation(bucketName) {
		const request = {
			Bucket: bucketName
		};
		try {
			return await this._retryOnTransientNetworkErrors('S3::GetBucketLocation', this.s3.getBucketLocation, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot get bucket location');
		}
	}

	/**
	 * Create a new bucket
	 *
	 * @param {Bucket} bucket Bucket definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the bucket is created
	 */
	async create(bucket) {
		const attributes = this._translateAttributes(bucket);
		try {
			return await this._createBucket(bucket.metadata.name, attributes);
		} catch (err) {
			if (err.name === 'BucketAlreadyOwnedByYou') {
				logger.info(`[${bucket.metadata.name}]: Bucket exists already and is owned by us, applying update instead`);
				return this.update(bucket);
			}

			throw err;
		}
	}

	/**
	 * Updates S3 bucket
	 *
	 * Creates a new bucket if it doesn't exists. Otherwise updates cause an error message.
	 *
	 * @param {Bucket} bucket Bucket definition in Kubernetes
	 * @return {Promise<any>} promise that resolves when the bucket is updated
	 */
	async update(bucket) {
		const bucketName = bucket.metadata.name;
		try {
			const response = await this._headBucket(bucketName);
			logger.error(`[${bucketName}]: Cannot update bucket: unsupported operation`);

			// - location: Cannot be changed, so we should just check whether getBucketLocation returns the correct one
			const {ACL, createBucketConfiguration = {locationConstraint: 'us-west-1'}} = this._translateAttributes(bucket);
			const locationConstraint = await this._getBucketLocation(bucketName);
			if (locationConstraint !== createBucketConfiguration.locationConstraint) {
				logger.error(`[${bucketName}]: Cannot update bucket location`);
				throw new Error('Invalid update');
			}

			// - acl: Overwrite it, letting AWS handle the problem of "update"
			await this._putBucketAcl(bucketName, {ACL});

			return response;
		} catch (err) {
			if (err.name === 'NotFound') {
				// Bucket doesn't exist: this means kubernetes saw an update, but in fact the bucket was never created,
				// or has been deleted in the meantime. Create it again.
				logger.info(`[${bucketName}]: Bucket does not/no longer exist, re-creating it`);
				return this.create(bucket);
			}

			throw err;
		}
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
