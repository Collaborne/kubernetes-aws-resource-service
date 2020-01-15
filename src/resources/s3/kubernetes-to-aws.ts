import {
	BucketLifecycleConfiguration,
	BucketLoggingStatus,
	PublicAccessBlockConfiguration,
	ServerSideEncryptionConfiguration,
	Tag,
	VersioningConfiguration,
} from 'aws-sdk/clients/s3';
import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';
import { KubernetesPolicy, KubernetesTag } from '../../types/kubernetes';

import {
	capitalize,
	capitalizeFieldNames,
	capitalizeFieldNamesForPath,
	injectResourceArn,
} from '../utils';
import * as Config from './kubernetes-config';

const logger = getLogger('s3/kubernetes-to-aws');

interface TranslateAttributesResult {
	attributes: {[key: string]: any};
	loggingParams: BucketLoggingStatus | null;
	policy: Policy | null;
	publicAccessBlockParams: PublicAccessBlockConfiguration | null;
	sseParams: ServerSideEncryptionConfiguration | null;
	versioningConfiguration: VersioningConfiguration | null;
	lifecycleConfiguration: BucketLifecycleConfiguration | null;
	tags: Tag[] | null;
}

/**
 * Convert the bucket.spec into parameters for the various AWS SDK operations.
 *
 * @param bucket a bucket definition
 * @return the bucket attributes
 */
export function translateSpec(bucket: Config.KubernetesBucket): TranslateAttributesResult {
	// Split the spec into parts
	const {
		lifecycleConfiguration,
		loggingConfiguration,
		bucketEncryption,
		publicAccessBlockConfiguration,
		versioningConfiguration,
		policy,
		tags,
		...otherAttributes
	} = bucket.spec;
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
	}, {} as {[key: string]: string});
	return {
		attributes,
		lifecycleConfiguration: translateLifecycleConfiguration(lifecycleConfiguration),
		loggingParams: translateLoggingConfiguration(loggingConfiguration),
		policy: translatePolicy(policy, bucket.metadata.name),
		publicAccessBlockParams: translatePublicAccessBlockConfiguration(publicAccessBlockConfiguration),
		sseParams: translateBucketEncryption(bucketEncryption),
		tags: translateTags(tags),
		versioningConfiguration: translateVersioningConfiguration(versioningConfiguration),
	};
}

/**
 * Translate the policy into the 'put bucket policy params' for the AWS SDK.
 *
 * @param bucketPolicy Bucket policy
 * @param bucketName the bucket name to inject into the policy
 * @returns the policy for use in AWS `PutBucketPolicy` requests or `null` if no policy is specified
 */
function translatePolicy(bucketPolicy: KubernetesPolicy | undefined, bucketName: string): Policy | null {
	if (!bucketPolicy) {
		return null;
	}

	const bucketArn = `arn:aws:s3:::${bucketName}`;
	return injectBucketArn(bucketName, capitalizeFieldNames(bucketPolicy), bucketArn);
}

/**
 * Inject the bucket ARN as 'Resource' into all statements of the policy
 *
 * @param bucketName name of the bucket
 * @param policy a policy
 * @param bucketArn a bucket ARN to attempt to inject
 * @return the policy, with the ARN injected if possible
 */
function injectBucketArn(bucketName: string, policy: Policy, bucketArn?: string): Policy {
	if (!bucketArn) {
		return policy;
	}

	logger.debug(`[${bucketName}]: Injecting resource ARN ${bucketArn} into policy document`);
	return injectResourceArn(policy, bucketArn);
}

/**
 * Translate the logging configuration into the AWS S3 `BucketLoggingStatus` type
 *
 * @param loggingConfiguration logging configuration
 * @returns the `BucketLoggingStatus` instance
 */
function translateLoggingConfiguration(loggingConfiguration?: Config.LoggingConfiguration): BucketLoggingStatus {
	let status;
	if (!loggingConfiguration) {
		status = {};
	} else {
		status = {
			LoggingEnabled: {
				TargetBucket: loggingConfiguration.destinationBucketName,
				TargetPrefix: loggingConfiguration.logFilePrefix,
			},
		};
	}

	return status;
}

/**
 * Translate the public access block configuration into the AWS S3 `PublicAccessBlockConfiguration`.
 *
 * @param publicAccessBlockConfiguration Public Access Block configuration
 * @returns the `PublicAccessBlockConfiguration` instance or `null`
 */
function translatePublicAccessBlockConfiguration(publicAccessBlockConfiguration?: Config.PublicAccessBlockConfiguration): PublicAccessBlockConfiguration | null {
	if (!publicAccessBlockConfiguration) {
		return null;
	}

	return {
		BlockPublicAcls: publicAccessBlockConfiguration.blockPublicAcls,
		BlockPublicPolicy: publicAccessBlockConfiguration.blockPublicPolicy,
		IgnorePublicAcls: publicAccessBlockConfiguration.ignorePublicAcls,
		RestrictPublicBuckets: publicAccessBlockConfiguration.restrictPublicBuckets,
	};
}

/**
 * Translate the versioning configuration into the AWS S3 `VersioningConfiguration`
 *
 * @param versioningConfiguration versioning configuration
 * @returns the `VersioningConfiguration` instance or `null`
 */
function translateVersioningConfiguration(versioningConfiguration?: Config.VersioningConfiguration): VersioningConfiguration | null {
	if (!versioningConfiguration) {
		return null;
	}

	return {
		Status: versioningConfiguration.status,
	};
}

function translateLifecycleConfiguration(lifecycleConfiguration?: Config.LifecycleConfiguration): BucketLifecycleConfiguration | null {
	if (!lifecycleConfiguration) {
		return null;
	}

	return {
		...capitalizeFieldNames(lifecycleConfiguration, capitalizeFieldNamesForPath, capitalizeFieldNameUpperId),
	};
}

/**
 * Translate the SSE configuration into the AWS S3 `ServerSideEncryptionConfiguration` for the AWS SDK.
 *
 * @param bucketEncryption Bucket encryption (as per {@link https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-bucketencryption.html})
 * @returns the parameters `ServerSideEncryptionConfiguration` instance or `null`
 */
function translateBucketEncryption(bucketEncryption?: Config.BucketEncryption): ServerSideEncryptionConfiguration | null {
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

	return {Rules: rules};
}

function translateTags(tags?: KubernetesTag[]): Tag[] | null {
	if (!tags) {
		return null;
	}

	return tags.map(tag => ({
		Key: tag.key,
		Value: tag.value,
	}));
}

function capitalizeFieldNameUpperId(s: string) {
	const result = capitalize(s);

	return result === 'Id' ? result.toUpperCase() : result;
}
