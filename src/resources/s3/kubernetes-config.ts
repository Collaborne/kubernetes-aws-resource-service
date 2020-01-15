import { BucketLocationConstraint } from 'aws-sdk/clients/s3';

import { KubernetesMetadata, KubernetesPolicy } from '../../types/kubernetes';

/**
 * A bucket resource in Kubernetes
 */
export interface KubernetesBucket {
	metadata: KubernetesMetadata;
	spec: BucketSpec;
}

type Acl =
	'private' |
	'public-read' |
	'public-read-write' |
	'aws-exec-read' |
	'authenticated-read' |
	'bucket-owner-read' |
	'bucket-owner-full-control' |
	'log-delivery-write';

/**
 * A bucket specification
 */
interface BucketSpec {
	/**
	 * The canned ACL to apply to the bucket
	 */
	acl?: Acl;
	createBucketConfiguration?: CreateBucketConfiguration;
	lifecycleConfiguration?: LifecycleConfiguration;
	loggingConfiguration?: LoggingConfiguration;
	/**
	 * configuration for SSE
	 */
	bucketEncryption?: BucketEncryption;
	/**
	 * "Public Access Block" policy of the bucket
	 */
	publicAccessBlockConfiguration?: PublicAccessBlockConfiguration;
	policy?: KubernetesPolicy;
	versioningConfiguration?: VersioningConfiguration;
	[key: string]: any;
}

interface CreateBucketConfiguration {
	locationConstraint: BucketLocationConstraint;
}

/**
 * Configuration of S3 bucket access logging.
 *
 * This structure is based on the definition in CloudFormation.
 */
export interface LoggingConfiguration {
	destinationBucketName: string;
	logFilePrefix: string;
}

/**
 * Configuration of Public Access Block.
 *
 * This structure is based on the definition in CloudFormation.
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-publicaccessblockconfiguration.html
 */
export interface PublicAccessBlockConfiguration {
	blockPublicAcls: boolean;
	blockPublicPolicy: boolean;
	ignorePublicAcls: boolean;
	restrictPublicBuckets: boolean;
}

/**
 * Configuration of VersioningConfiguration.
 *
 * This structure is based on the definition in CloudFormation.
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-versioningconfig.html
 */
export interface VersioningConfiguration {
	status: 'Enabled' | 'Suspended';
}

interface ServerSideEncryptionConfigurationRule {
	serverSideEncryptionByDefault: {
		sseAlgorithm: 'AES256' | 'aws:kms';
		kmsMasterKeyId?: string;
	};
}
export interface BucketEncryption {
	serverSideEncryptionConfiguration?: ServerSideEncryptionConfigurationRule[];
}

export interface LifecycleConfiguration {
	[key: string]: any;
}
