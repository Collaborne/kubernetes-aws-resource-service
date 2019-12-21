import {
	PutBucketEncryptionRequest,
	PutBucketLifecycleConfigurationRequest,
	PutBucketLoggingRequest,
	PutBucketPolicyRequest,
	PutBucketVersioningRequest,
	PutPublicAccessBlockRequest,
} from 'aws-sdk/clients/s3';
import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';
import { KubernetesPolicy } from '../../types/kubernetes';

import {
	capitalize,
	capitalizeFieldNames,
	capitalizeFieldNamesForPath,
	injectResourceArn,
} from '../utils';
import {
	BucketEncryption,
	KubernetesBucket,
	LifecycleConfiguration,
	LoggingConfiguration,
	PublicAccessBlockConfiguration,
	VersioningConfiguration,
} from './kubernetes-config';

const logger = getLogger('s3/kubernetes-to-aws');

interface TranslateAttributesResult {
	attributes: {[key: string]: any};
	loggingParams: PutBucketLoggingRequest | null;
	policy: PutBucketPolicyRequest | null;
	publicAccessBlockParams: PutPublicAccessBlockRequest | null;
	sseParams: PutBucketEncryptionRequest | null;
	versioningConfiguration: PutBucketVersioningRequest | null;
	lifecycleConfiguration: PutBucketLifecycleConfigurationRequest | null;
}

/**
 * Convert the bucket.spec into parameters for the various AWS SDK operations.
 *
 * The resulting elements do not have the bucket name set.
 *
 * @param bucket a bucket definition
 * @return the bucket attributes
 */
export function translateSpec(bucket: KubernetesBucket): TranslateAttributesResult {
	// Split the spec into parts
	const {
		lifecycleConfiguration,
		loggingConfiguration,
		bucketEncryption,
		publicAccessBlockConfiguration,
		versioningConfiguration,
		policy,
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
		lifecycleConfiguration: translateLifecycleConfiguration(bucket.metadata.name, lifecycleConfiguration),
		loggingParams: translateLoggingConfiguration(bucket.metadata.name, loggingConfiguration),
		policy: translatePolicy(bucket.metadata.name, policy),
		publicAccessBlockParams: translatePublicAccessBlockConfiguration(bucket.metadata.name, publicAccessBlockConfiguration),
		sseParams: translateBucketEncryption(bucket.metadata.name, bucketEncryption),
		versioningConfiguration: translateVersioningConfiguration(bucket.metadata.name, versioningConfiguration),
	};
}

/**
 * Translate the policy into the 'put bucket policy params' for the AWS SDK.
 *
 * @param bucketName the bucket name
 * @param bucketPolicy Bucket policy
 * @returns the parameters for `putBucketPolicy`, or `null`
 */
function translatePolicy(bucketName: string, bucketPolicy?: KubernetesPolicy): PutBucketPolicyRequest | null {
	if (!bucketPolicy) {
		return null;
	}

	const bucketArn = `arn:aws:s3:::${bucketName}`;
	return {
		Bucket: bucketName,

		/* XXX: For now do not allow setting this value */
		ConfirmRemoveSelfBucketAccess: false,
		Policy: JSON.stringify(injectBucketArn(bucketName, capitalizeFieldNames(bucketPolicy), bucketArn), undefined, 0),
	};
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
 * Translate the logging configuration into the 'logging params' for the AWS SDK.
 *
 * @param bucketName the bucket name
 * @param loggingConfiguration logging configuration
 * @returns the parameters for `putBucketLogging`
 */
function translateLoggingConfiguration(
	bucketName: string,
	loggingConfiguration?: LoggingConfiguration,
): PutBucketLoggingRequest {
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

	return {
		Bucket: bucketName,
		BucketLoggingStatus: status,
	};
}

/**
 * Translate the logging configuration into the 'logging params' for the AWS SDK.
 *
 * @param bucketName the bucket name
 * @param publicAccessBlockConfiguration Public Access Block configuration
 * @returns the parameters for `putPublicAccessBlock`, or `null`
 */
function translatePublicAccessBlockConfiguration(
	bucketName: string,
	publicAccessBlockConfiguration?: PublicAccessBlockConfiguration,
): PutPublicAccessBlockRequest | null {
	if (!publicAccessBlockConfiguration) {
		return null;
	}

	return {
		Bucket: bucketName,
		PublicAccessBlockConfiguration: {
			BlockPublicAcls: publicAccessBlockConfiguration.blockPublicAcls,
			BlockPublicPolicy: publicAccessBlockConfiguration.blockPublicPolicy,
			IgnorePublicAcls: publicAccessBlockConfiguration.ignorePublicAcls,
			RestrictPublicBuckets: publicAccessBlockConfiguration.restrictPublicBuckets,
		},
	};
}

/**
 * Translate the logging configuration into the 'versioning configuration' for the AWS SDK.
 *
 * @param bucketName the bucket name
 * @param versioningConfiguration Public Access Block configuration
 * @returns the parameters for `versioningConfiguration`, or `null`
 */
function translateVersioningConfiguration(
	bucketName: string,
	versioningConfiguration?: VersioningConfiguration,
): PutBucketVersioningRequest | null {
	if (!versioningConfiguration) {
		return null;
	}

	return {
		Bucket: bucketName,
		VersioningConfiguration: {
			Status: versioningConfiguration.status,
		},
	};
}

function translateLifecycleConfiguration(
	bucketName: string,
	lifecycleConfiguration?: LifecycleConfiguration,
): PutBucketLifecycleConfigurationRequest | null {
	if (!lifecycleConfiguration) {
		return null;
	}

	return {
		Bucket: bucketName,
		LifecycleConfiguration: {
			...capitalizeFieldNames(lifecycleConfiguration, capitalizeFieldNamesForPath, capitalizeFieldNameUpperId),
		},
	};
}

/**
 * Translate the SSE configuration into the 'server-side encryption params' for the AWS SDK.
 *
 * @param bucketName the bucket name
 * @param bucketEncryption Bucket encryption (as per https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-bucketencryption.html)
 * @returns the parameters for `putBucketEncryption`, or `null`
 */
function translateBucketEncryption(
	bucketName: string,
	bucketEncryption?: BucketEncryption,
): PutBucketEncryptionRequest | null {
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

function capitalizeFieldNameUpperId(s: string) {
	const result = capitalize(s);

	return result === 'Id' ? result.toUpperCase() : result;
}
