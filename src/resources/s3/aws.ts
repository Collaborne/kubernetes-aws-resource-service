import { S3 } from 'aws-sdk';
import {
	BucketLifecycleConfiguration,
	BucketLoggingStatus,
	CreateBucketRequest,
	DeleteBucketEncryptionRequest,
	DeleteBucketLifecycleRequest,
	DeleteBucketPolicyRequest,
	DeleteBucketRequest,
	DeletePublicAccessBlockRequest,
	GetBucketLocationRequest,
	HeadBucketRequest,
	PublicAccessBlockConfiguration,
	PutBucketAclRequest,
	PutBucketEncryptionRequest,
	PutBucketLifecycleConfigurationRequest,
	PutBucketLoggingRequest,
	PutBucketPolicyRequest,
	PutBucketTaggingRequest,
	PutBucketVersioningRequest,
	PutPublicAccessBlockRequest,
	ServerSideEncryptionConfiguration,
	Tag,
	VersioningConfiguration,
	PutBucketCorsRequest,
	CORSRule,
	DeleteBucketCorsRequest,
} from 'aws-sdk/clients/s3';

import { Policy } from '../../types/aws';
import { retryOnTransientNetworkErrors } from '../utils';

/**
 * Client to connect to AWS S3
 */
export class S3Client {
	private s3: S3;

	constructor(options: S3.Types.ClientConfiguration = {}) {
		this.s3 = new S3(options);
	}

	public createBucket(bucketName: string, attributes: {[key: string]: any}) {
		if (attributes.Bucket && attributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${attributes.Bucket}`);
		}
		const request: CreateBucketRequest = {
			...attributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::CreateBucket', () => this.s3.createBucket(request));
	}

	public putBucketLogging(bucketName: string, loggingStatus: BucketLoggingStatus | null) {
		const request: PutBucketLoggingRequest = {
			Bucket: bucketName,
			BucketLoggingStatus: loggingStatus || {},
		};
		return retryOnTransientNetworkErrors('S3::PutBucketLogging', () => this.s3.putBucketLogging(request));
	}

	public putBucketEncryption(bucketName: string, serverSideEncryptionConfiguration: ServerSideEncryptionConfiguration) {
		const request: PutBucketEncryptionRequest = {
			Bucket: bucketName,
			ServerSideEncryptionConfiguration: serverSideEncryptionConfiguration,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketEncryption', () => this.s3.putBucketEncryption(request));
	}

	public putPublicAccessBlock(bucketName: string, publicAccessBlockConfiguration: PublicAccessBlockConfiguration) {
		const request: PutPublicAccessBlockRequest = {
			Bucket: bucketName,
			PublicAccessBlockConfiguration: publicAccessBlockConfiguration,
		};
		return retryOnTransientNetworkErrors('S3::PutPublicAccessBlock', () => this.s3.putPublicAccessBlock(request));
	}

	public async putVersioningConfiguration(bucketName: string, versioningConfigurationParams: VersioningConfiguration | null) {
		// S3 buckets can have the state: Enabled/Suspended/nothing (the later happens
		// when versioning was never set)
		// We don't want to set versioning if it's not in S3. If versioning was formerly
		// set in S3: it should be suspended if the config isn't set in our config.
		let versioningConfiguration: VersioningConfiguration;
		if (!versioningConfigurationParams) {
			const currentStatusRequest = {Bucket: bucketName};
			const currentStatusRespose = await retryOnTransientNetworkErrors('S3::GetBucketVersioning', () => this.s3.getBucketVersioning(currentStatusRequest));
			if (!currentStatusRespose.Status) {
				// Not having versioning configuration for a bucket that was never configured is fine
				return Promise.resolve();
			}

			versioningConfiguration = {
				Status: 'Suspended',
			};
		} else {
			versioningConfiguration = versioningConfigurationParams;
		}

		const request: PutBucketVersioningRequest = {
			Bucket: bucketName,
			VersioningConfiguration: versioningConfiguration,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketVersioning', () => this.s3.putBucketVersioning(request));
	}

	public putLifecycleConfiguration(bucketName: string, lifecycleConfiguration?: BucketLifecycleConfiguration) {
		const request: PutBucketLifecycleConfigurationRequest = {
			Bucket: bucketName,
			LifecycleConfiguration: lifecycleConfiguration,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketLifecycleConfiguration', () => this.s3.putBucketLifecycleConfiguration(request));
	}

	public deleteLifecycleConfiguration(bucketName: string) {
		const request: DeleteBucketLifecycleRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeleteBucketLifecycle', () => this.s3.deleteBucketLifecycle(request));
	}

	public putTagging(bucketName: string, tags: Tag[] | null) {
		const request: PutBucketTaggingRequest = {
			Bucket: bucketName,
			Tagging: {
				TagSet: tags || [],
			},
		};
		return retryOnTransientNetworkErrors('S3::PutBucketTagging', () => this.s3.putBucketTagging(request));
	}

	public putBucketAcl(bucketName: string, aclAttributes: Omit<PutBucketAclRequest, 'Bucket'>) {
		const request: PutBucketAclRequest = {
			Bucket: bucketName,
			...aclAttributes,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketAcl', () => this.s3.putBucketAcl(request));
	}

	public putBucketPolicy(bucketName: string, policy: Policy, confirmRemoveSelfBucketAccess: boolean) {
		const request: PutBucketPolicyRequest = {
			Bucket: bucketName,
			ConfirmRemoveSelfBucketAccess: confirmRemoveSelfBucketAccess,
			Policy: JSON.stringify(policy, undefined, 0),
		};
		return retryOnTransientNetworkErrors('S3::PutBucketPolicy', () => this.s3.putBucketPolicy(request));
	}

	public deleteBucket(bucketName: string) {
		const request: DeleteBucketRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeleteBucket', () => this.s3.deleteBucket(request));
	}

	public deleteBucketEncryption(bucketName: string) {
		const request: DeleteBucketEncryptionRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeleteBucketEncryption', () => this.s3.deleteBucketEncryption(request));
	}

	public deletePublicAccessBlock(bucketName: string) {
		const request: DeletePublicAccessBlockRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeletePublicAccessBlock', () => this.s3.deletePublicAccessBlock(request));
	}

	public deleteBucketPolicy(bucketName: string) {
		const request: DeleteBucketPolicyRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3:DeleteBucketPolicy', () => this.s3.deleteBucketPolicy(request));
	}

	public headBucket(bucketName: string) {
		const request: HeadBucketRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::HeadBucket', () => this.s3.headBucket(request));
	}

	public getBucketLocation(bucketName: string) {
		const request: GetBucketLocationRequest = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::GetBucketLocation', () => this.s3.getBucketLocation(request));
	}

	public putBucketCorsRules(bucketName: string, corsRules: CORSRule[]) {
		const request: PutBucketCorsRequest = {
			Bucket: bucketName,
			CORSConfiguration: {
				CORSRules: corsRules,
			},
		};
		// XXX: Note that the IAM action is 's3::PutBucketCORS'
		return retryOnTransientNetworkErrors('S3::PutBucketCors', () => this.s3.putBucketCors(request));
	}

	public deleteBucketCorsRules(bucketName: string) {
		const request: DeleteBucketCorsRequest = {
			Bucket: bucketName,
		};
		// XXX: Note that the IAM action is 's3::PutBucketCORS'
		return retryOnTransientNetworkErrors('S3::DeleteBucketCors', () => this.s3.deleteBucketCors(request));
	}
}
