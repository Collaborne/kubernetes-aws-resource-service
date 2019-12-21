import { S3 } from 'aws-sdk';
import {
	PutBucketAclRequest,
	PutBucketEncryptionRequest,
	PutBucketLifecycleConfigurationRequest,
	PutBucketLoggingRequest,
	PutBucketPolicyRequest,
	PutBucketVersioningRequest,
	PutPublicAccessBlockRequest,
} from 'aws-sdk/clients/s3';

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
		const request = {
			...attributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::CreateBucket', () => this.s3.createBucket(request));
	}

	public putBucketLogging(bucketName: string, loggingAttributes: PutBucketLoggingRequest) {
		if (loggingAttributes.Bucket && loggingAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${loggingAttributes.Bucket}`);
		}
		const request = {
			...loggingAttributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketLogging', () => this.s3.putBucketLogging(request));
	}

	public putBucketEncryption(bucketName: string, sseAttributes: PutBucketEncryptionRequest) {
		if (sseAttributes.Bucket && sseAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${sseAttributes.Bucket}`);
		}
		const request = {
			...sseAttributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketEncryption', () => this.s3.putBucketEncryption(request));
	}

	public putPublicAccessBlock(bucketName: string, publicAccessBlockParams: PutPublicAccessBlockRequest) {
		if (publicAccessBlockParams.Bucket && publicAccessBlockParams.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${publicAccessBlockParams.Bucket}`);
		}
		const request = {
			...publicAccessBlockParams,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutPublicAccessBlock', () => this.s3.putPublicAccessBlock(request));
	}

	public async putVersioningConfiguration(bucketName: string, versioningConfigurationParams: PutBucketVersioningRequest) {
		// S3 buckets can have the state: Enabled/Suspended/nothing (the later happens
		// when versioning was never set)
		// We don't want to set versioning if it's not in S3. If versioning was formerly
		// set in S3: it should be suspended if the config isn't set in our config.
		let versioningConfiguration;
		if (!versioningConfigurationParams) {
			const currentStatusRequest = {Bucket: bucketName};
			const currentStatusRespose = await retryOnTransientNetworkErrors('S3::GetBucketVersioning', () => this.s3.getBucketVersioning(currentStatusRequest));
			if (!currentStatusRespose.Status) {
				// Not having versioning configuration for a bucket that was never configured is fine
				return Promise.resolve();
			}

			versioningConfiguration = {
				Bucket: bucketName,
				VersioningConfiguration: {
					Status: 'Suspended',
				},
			};
		} else {
			if (versioningConfigurationParams.Bucket && versioningConfigurationParams.Bucket !== bucketName) {
				throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${versioningConfigurationParams.Bucket}`);
			}

			versioningConfiguration = versioningConfigurationParams;
		}

		const request = {
			...versioningConfiguration,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketVersioning', () => this.s3.putBucketVersioning(request));
	}

	public putLifecycleConfiguration(bucketName: string, lifecycleConfigurationParams: PutBucketLifecycleConfigurationRequest) {
		if (lifecycleConfigurationParams.Bucket && lifecycleConfigurationParams.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${lifecycleConfigurationParams.Bucket}`);
		}
		const request = {
			...lifecycleConfigurationParams,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketLifecycleConfiguration', () => this.s3.putBucketLifecycleConfiguration(request));
	}

	public putBucketAcl(bucketName: string, aclAttributes: Omit<PutBucketAclRequest, 'Bucket'> & {Bucket?: string}) {
		if (aclAttributes.Bucket && aclAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${aclAttributes.Bucket}`);
		}
		const request = {
			...aclAttributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketAcl', () => this.s3.putBucketAcl(request));
	}

	public putBucketPolicy(bucketName: string, policyAttributes: PutBucketPolicyRequest) {
		if (policyAttributes.Bucket && policyAttributes.Bucket !== bucketName) {
			throw new Error(`Inconsistent bucket name in configuration: ${bucketName} !== ${policyAttributes.Bucket}`);
		}
		const request = {
			...policyAttributes,
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::PutBucketPolicy', () => this.s3.putBucketPolicy(request));
	}

	public deleteBucket(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeleteBucket', () => this.s3.deleteBucket(request));
	}

	public deleteBucketEncryption(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeleteBucketEncryption', () => this.s3.deleteBucketEncryption(request));
	}

	public deletePublicAccessBlock(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::DeletePublicAccessBlock', () => this.s3.deletePublicAccessBlock(request));
	}

	public deleteBucketPolicy(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3:DeleteBucketPolicy', () => this.s3.deleteBucketPolicy(request));
	}

	public headBucket(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::HeadBucket', () => this.s3.headBucket(request));
	}

	public getBucketLocation(bucketName: string) {
		const request = {
			Bucket: bucketName,
		};
		return retryOnTransientNetworkErrors('S3::GetBucketLocation', () => this.s3.getBucketLocation(request));
	}
}
