import { getLogger } from 'log4js';

import { ResourceClient } from '../client';
import { S3Client } from './aws';
import { KubernetesBucket } from './kubernetes-config';
import { translateSpec } from './kubernetes-to-aws';

const logger = getLogger('S3');

/**
 * A adapter for modifying AWS S3 buckets using Bucket definitions
 */
export class S3Bucket implements ResourceClient<KubernetesBucket> {
	private s3Client: S3Client;

	/**
	 *
	 * @param {Object} [options] S3 client options
	 */
	constructor(options = {}, s3Client?: S3Client) {
		this.s3Client = s3Client || new S3Client(options);
	}

	/**
	 * Create a new bucket
	 *
	 * @param bucket Bucket definition in Kubernetes
	 * @return promise that resolves when the bucket is created
	 */
	public async create(bucket: KubernetesBucket): Promise<any> {
		const {
			attributes,
			lifecycleConfiguration,
			loggingParams,
			policy,
			publicAccessBlockParams,
			sseParams,
			tags,
			versioningConfiguration,
		} = translateSpec(bucket);
		try {
			// Create the bucket, and wait until that has happened
			const response = await this.s3Client.createBucket(bucket.metadata.name, attributes);

			// Apply all other operations
			// Note: These need to be await-ed separately, as we otherwise may hit "conflicting conditional operations",
			// which won't be retried.
			if (policy) {
				await this.s3Client.putBucketPolicy(bucket.metadata.name, policy);
			}
			if (loggingParams) {
				await this.s3Client.putBucketLogging(bucket.metadata.name, loggingParams);
			}
			if (publicAccessBlockParams) {
				await this.s3Client.putPublicAccessBlock(bucket.metadata.name, publicAccessBlockParams);
			}
			if (sseParams) {
				await this.s3Client.putBucketEncryption(bucket.metadata.name, sseParams);
			}
			if (versioningConfiguration) {
				await this.s3Client.putVersioningConfiguration(bucket.metadata.name, versioningConfiguration);
			}
			if (lifecycleConfiguration) {
				await this.s3Client.putLifecycleConfiguration(bucket.metadata.name, lifecycleConfiguration);
			}
			if (tags) {
				await this.s3Client.putTagging(bucket.metadata.name, tags);
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
	 * @param bucket Bucket definition in Kubernetes
	 * @return promise that resolves when the bucket is updated
	 */
	public async update(bucket: KubernetesBucket) {
		function isCompatibleBucketLocation(location: string | undefined, locationRequested: string) {
			if (location === locationRequested) {
				return true;
			}

			if (location && locationRequested === 'EU') {
				return location.startsWith('eu-');
			}

			return false;
		}

		const bucketName = bucket.metadata.name;
		try {
			const response = await this.s3Client.headBucket(bucketName);

			// - location: Cannot be changed, so we should just check whether getBucketLocation returns the correct one
			const {
				attributes: {ACL, CreateBucketConfiguration = {LocationConstraint: 'us-west-1'}},
				lifecycleConfiguration,
				loggingParams,
				policy,
				publicAccessBlockParams,
				sseParams,
				tags,
				versioningConfiguration,
			} = translateSpec(bucket);
			const bucketLocation = await this.s3Client.getBucketLocation(bucketName);
			if (!isCompatibleBucketLocation(bucketLocation.LocationConstraint, CreateBucketConfiguration.LocationConstraint)) {
				logger.error(`[${bucketName}]: Cannot update bucket location from ${bucketLocation} to ${CreateBucketConfiguration.locationConstraint}`);
				throw new Error('Invalid update: Cannot update bucket location');
			}

			// - acl, logging, policy, Public Access Block, encryption: Overwrite it, letting AWS handle the problem of "update"
			// Note: These need to be await-ed separately, as we otherwise may hit "conflicting conditional operations",
			// which won't be retried.
			if (ACL) {
				await this.s3Client.putBucketAcl(bucketName, {ACL});
			}
			if (policy) {
				await this.s3Client.putBucketPolicy(bucketName, policy);
			} else {
				await this.s3Client.deleteBucketPolicy(bucketName);
			}
			if (loggingParams) {
				await this.s3Client.putBucketLogging(bucketName, loggingParams);
			}
			if (publicAccessBlockParams) {
				await this.s3Client.putPublicAccessBlock(bucketName, publicAccessBlockParams);
			} else {
				await this.s3Client.deletePublicAccessBlock(bucketName);
			}
			if (sseParams) {
				await this.s3Client.putBucketEncryption(bucket.metadata.name, sseParams);
			} else {
				await this.s3Client.deleteBucketEncryption(bucket.metadata.name);
			}
			if (versioningConfiguration) {
				await this.s3Client.putVersioningConfiguration(bucket.metadata.name, versioningConfiguration);
			}
			if (lifecycleConfiguration) {
				await this.s3Client.putLifecycleConfiguration(bucket.metadata.name, lifecycleConfiguration);
			}
			if (tags) {
				await this.s3Client.putTagging(bucket.metadata.name, tags);
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
	 * @param bucket Bucket definition in Kubernetes
	 * @return a promise that resolves when the bucket was deleted
	 */
	public delete(bucket: KubernetesBucket) {
		return this.s3Client.deleteBucket(bucket.metadata.name);
	}
}
