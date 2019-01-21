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
 * @property {LoggingConfiguration} [loggingConfiguration]
 * @property {BucketEncryption} [bucketEncryption] optional configuration for SSE
 */

/**
 * @typedef CreateBucketConfiguration
 * @property {("EU"|"eu-west-1"|"us-west-1"|"us-west-2"|"ap-south-1"|"ap-southeast-1"|"ap-southeast-2"|"ap-northeast-1"|"sa-east-1"|"cn-north-1"|"eu-central-1")} locationConstraint
 */

/**
 * Configuration of S3 bucket access logging.
 *
 * This structure is based on the definition in CloudFormation.
 *
 * @typedef LoggingConfiguration
 * @property {string} destinationBucketName
 * @property {string} logFilePrefix
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
	 * Translate the logging configuration into the 'logging params' for the AWS SDK.
	 *
	 * @param {string} bucketName the bucket name
	 * @param {LoggingConfiguration} loggingConfiguration logging configuration
	 * @returns {Object} the parameters for `putBucketLogging`
	 */
	_translateLoggingConfiguration(bucketName, loggingConfiguration) {
		let status;
		if (!loggingConfiguration) {
			status = {};
		} else {
			status = {
				LoggingEnabled: {
					TargetBucket: loggingConfiguration.destinationBucketName,
					TargetPrefix: loggingConfiguration.logFilePrefix,
				}
			};
		}

		return {
			Bucket: bucketName,
			BucketLoggingStatus: status
		};
	}

	/**
	 * Translate the logging configuration into the 'logging params' for the AWS SDK.
	 *
	 * @param {string} bucketName the bucket name
	 * @param {PublicAccessBlockConfiguration} publicAccessBlockConfiguration Public Access Block configuration
	 * @returns {Object} the parameters for `putPublicAccessBlock`
	 */
	_translatePublicAccessBlockConfiguration(bucketName, publicAccessBlockConfiguration) {
		let status;
		if (!publicAccessBlockConfiguration) {
			status = {};
		} else {
			status = {
				BlockPublicAcls: publicAccessBlockConfiguration.blockPublicAcls,
			};
		}

		return {
			Bucket: bucketName,
			PublicAccessBlockConfiguration: status
		};
	}

	/**
	 * Translate the SSE configuration into the 'server-side encryption params' for the AWS SDK.
	 *
	 * @param {string} bucketName the bucket name
	 * @param {BucketEncryption} bucketEncryption Bucket encryption (as per https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-bucketencryption.html)
	 * @returns {Object} the parameters for `putBucketEncryption`, or `null`
	 */
	_translateBucketEncryption(bucketName, bucketEncryption) {
		if (!bucketEncryption || !bucketEncryption.serverSideEncryptionConfiguration) {
			return null;
		}

		const rules = bucketEncryption.serverSideEncryptionConfiguration.map(rule => {
			// Determine the type of rule by looking at the keys in the rule
			// We need to do a case-insensitive comparison here!
			if (rule.serverSideEncryptionByDefault) {
				switch (rule.serverSideEncryptionByDefault.sseAlgorithm) {
				case 'AES256':
					// Sanity check: This will otherwise produce errors when applying the configuration
					if (rule.serverSideEncryptionByDefault.kmsMasterKeyId) {
						throw new Error('Unexpected kmsMasterKeyId in AES256 SSE configuration');
					}
					return {
						ApplyServerSideEncryptionByDefault: {
							SSEAlgorithm: rule.serverSideEncryptionByDefault.sseAlgorithm,
						},
					};
				case 'aws:kms':
					return {
						ApplyServerSideEncryptionByDefault: {
							KMSMasterKeyId: rule.serverSideEncryptionByDefault.kmsMasterKeyId,
							SSEAlgorithm: rule.serverSideEncryptionByDefault.sseAlgorithm,
						},
					};

				default:
					throw new Error(`Unsupported SSE algorithm ${rule.serverSideEncryptionByDefault.sseAlgorithm} for default encryption`);
				}
			}

			throw new Error(`Unsupport SSE rule with keys: ${Object.keys(rule)}`);
		});
		if (rules.length === 0) {
			// No rules: Assume no intent to configure default bucket encryption
			// This is different from "invalid rule"!
			return null;
		}

		return {
			Bucket: bucketName,
			ServerSideEncryptionConfiguration: {
				Rules: rules,
			},
		};
	}

	/**
	 * Convert the bucket.spec into parameters for the various AWS SDK operations.
	 *
	 * The resulting elements do not have the bucket name set.
	 *
	 * @param {Bucket} bucket a bucket definition
	 * @return {Object} the bucket attributes
	 */
	_translateSpec(bucket) {
		// Split the spec into parts
		const {loggingConfiguration, bucketEncryption, publicAccessBlockConfiguration, ...otherAttributes} = bucket.spec;
		const attributes = Object.keys(otherAttributes || {}).reduce((result, key) => {
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
			logger.debug(`[${bucket.metadata.name}]: Attribute ${key} = ${JSON.stringify(resultValue)}`);

			result[resultKey] = resultValue;
			return result;
		}, {});
		return {
			attributes,
			loggingParams: this._translateLoggingConfiguration(bucket.metadata.name, loggingConfiguration),
			publicAccessBlockParams: this._translatePublicAccessBlockConfiguration(bucket.metadata.name, publicAccessBlockConfiguration),
			sseParams: this._translateBucketEncryption(bucket.metadata.name, bucketEncryption),
		};
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

	async _putBucketLogging(bucketName, loggingAttributes) {
		if (loggingAttributes.Bucket && loggingAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${loggingAttributes.Bucket}`);
		}
		const request = Object.assign({}, loggingAttributes, {
			Bucket: bucketName
		});
		try {
			return await this._retryOnTransientNetworkErrors('S3::PutBucketLogging', this.s3.putBucketLogging, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot configure bucket logging');
		}
	}

	async _putBucketEncryption(bucketName, sseAttributes) {
		if (sseAttributes.Bucket && sseAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${sseAttributes.Bucket}`);
		}
		const request = Object.assign({}, sseAttributes, {
			Bucket: bucketName
		});
		try {
			return await this._retryOnTransientNetworkErrors('S3::PutBucketEncryption', this.s3.putBucketEncryption, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot configure bucket encryption');
		}
	}

	async _putPublicAccessBlock(bucketName, publicAccessBlockParams) {
		if (publicAccessBlockParams.Bucket && publicAccessBlockParams.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${publicAccessBlockParams.Bucket}`);
		}
		const request = Object.assign({}, publicAccessBlockParams, {
			Bucket: bucketName,
		});
		try {
			return await this._retryOnTransientNetworkErrors('S3::PutPublicAccessBlock', this.s3.putPublicAccessBlock, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot configure Block Public Access for bucket');
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

	async _deleteBucketEncryption(bucketName) {
		const request = {
			Bucket: bucketName
		};
		try {
			return await this._retryOnTransientNetworkErrors('S3::DeleteBucketEncryption', this.s3.deleteBucketEncryption, [request]);
		} catch (err) {
			return this._reportError(bucketName, err, 'Cannot remove bucket encryption');
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
		const {attributes, loggingParams, publicAccessBlockParams, sseParams} = this._translateSpec(bucket);
		try {
			// Create the bucket, and wait until that has happened
			const response = await this._createBucket(bucket.metadata.name, attributes);

			// Apply all other operations
			// Note: These need to be await-ed separately, as we otherwise may hit "conflicting conditional operations", which won't be retried.
			await this._putBucketLogging(bucket.metadata.name, loggingParams);
			await this._putPublicAccessBlock(bucket, publicAccessBlockParams);
			if (sseParams) {
				await this._putBucketEncryption(bucket.metadata.name, sseParams);
			}

			return response;
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
		function isCompatibleBucketLocation(location, locationRequested) {
			if (location === locationRequested) {
				return true;
			}

			if (locationRequested === 'EU') {
				return location.startsWith('eu-');
			}

			return false;
		}

		const bucketName = bucket.metadata.name;
		try {
			const response = await this._headBucket(bucketName);

			// - location: Cannot be changed, so we should just check whether getBucketLocation returns the correct one
			const {attributes: {ACL, CreateBucketConfiguration = {LocationConstraint: 'us-west-1'}}, loggingParams, sseParams, publicAccessBlockParams} = this._translateSpec(bucket);
			const bucketLocation = await this._getBucketLocation(bucketName);
			if (!isCompatibleBucketLocation(bucketLocation.LocationConstraint, CreateBucketConfiguration.LocationConstraint)) {
				logger.error(`[${bucketName}]: Cannot update bucket location from ${bucketLocation} to ${CreateBucketConfiguration.locationConstraint}`);
				throw new Error('Invalid update: Cannot update bucket location');
			}

			// - acl, logging, Public Access Block, encryption: Overwrite it, letting AWS handle the problem of "update"
			// Note: These need to be await-ed separately, as we otherwise may hit "conflicting conditional operations", which won't be retried.
			await this._putBucketAcl(bucketName, {ACL});
			await this._putBucketLogging(bucketName, loggingParams);
			await this._putPublicAccessBlock(bucket, publicAccessBlockParams);
			if (sseParams) {
				await this._putBucketEncryption(bucket.metadata.name, sseParams);
			} else {
				await this._deleteBucketEncryption(bucket.metadata.name);
			}

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
