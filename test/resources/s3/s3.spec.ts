import { expect } from 'chai';
import 'mocha';

import { LoggingEnabled } from 'aws-sdk/clients/s3';

import { S3Client } from '../../../src/resources/s3/aws';
import { KubernetesBucket, LoggingConfiguration } from '../../../src/resources/s3/kubernetes-config';
import { S3Bucket } from '../../../src/resources/s3/s3';

class TestS3Client extends S3Client {
	public async headBucket() {
		return {};
	}
	public async getBucketLocation() {
		return {
			LocationConstraint: 'us-west-1',
		};
	}
	public async putVersioningConfiguration() {
		return {};
	}
	public async deleteBucketPolicy() {
		return {};
	}
	public async deletePublicAccessBlock() {
		return {};
	}
	public async deleteBucketEncryption() {
		return {};
	}
	public async deleteLifecycleConfiguration() {
		return {};
	}
	public async deleteBucketCorsRules() {
		return {};
	}
	public async putTagging() {
		return {};
	}
}

describe('S3Bucket', () => {
	describe('update', () => {
		// tslint:disable-next-line: max-classes-per-file
		class LoggingTestS3Client extends TestS3Client {
			private called?: boolean;

			constructor(private current?: LoggingEnabled) {
				super();
			}

			public async getBucketLogging() {
				this.called = false;
				return {
					LoggingEnabled: this.current,
				};
			}
			public async putBucketLogging() {
				this.called = true;
				return Promise.resolve({});
			}

			public get putBucketLoggingCalled() {
				return this.called;
			}
		}

		const NO_CHANGE_CASES: Array<[LoggingConfiguration|undefined, LoggingEnabled|undefined]> = [
			[undefined, undefined],
			[{
				destinationBucketName: 'bucket',
				logFilePrefix: 'prefix',
			}, {
				TargetBucket: 'bucket',
				TargetPrefix: 'prefix',
			}],
		];

		NO_CHANGE_CASES.forEach(([spec, current]) => {
			it(`does not call PutBucketLogging if no change (spec = ${JSON.stringify(spec)}, current = ${JSON.stringify(current)}})`, async () => {
				const s3Client = new LoggingTestS3Client(current);
				const bucket = new S3Bucket({}, s3Client);
				const resource: KubernetesBucket = {
					metadata: {
						name: 'test',
					},
					spec: {
						loggingConfiguration: spec,
					},
				};
				await bucket.update(resource);
				expect(s3Client.putBucketLoggingCalled).to.be.false;
			});
		});

		it(`calls PutBucketLogging if change in target bucket`, async () => {
			const s3Client = new LoggingTestS3Client({
				TargetBucket: 'current-bucket',
				TargetPrefix: 'prefix',
			});
			const bucket = new S3Bucket({}, s3Client);
			const resource: KubernetesBucket = {
				metadata: {
					name: 'test',
				},
				spec: {
					loggingConfiguration: {
						destinationBucketName: 'updated-bucket',
						logFilePrefix: 'prefix',
					},
				},
			};
			await bucket.update(resource);
			expect(s3Client.putBucketLoggingCalled).to.be.true;
		});
		it(`calls PutBucketLogging if change in target prefix`, async () => {
			const s3Client = new LoggingTestS3Client({
				TargetBucket: 'bucket',
				TargetPrefix: 'current-prefix',
			});
			const bucket = new S3Bucket({}, s3Client);
			const resource: KubernetesBucket = {
				metadata: {
					name: 'test',
				},
				spec: {
					loggingConfiguration: {
						destinationBucketName: 'bucket',
						logFilePrefix: 'updated-prefix',
					},
				},
			};
			await bucket.update(resource);
			expect(s3Client.putBucketLoggingCalled).to.be.true;
		});
		it(`calls PutBucketLogging if change to undefined`, async () => {
			const s3Client = new LoggingTestS3Client({
				TargetBucket: 'bucket',
				TargetPrefix: 'prefix',
			});
			const bucket = new S3Bucket({}, s3Client);
			const resource: KubernetesBucket = {
				metadata: {
					name: 'test',
				},
				spec: {
					// Nothing
				},
			};
			await bucket.update(resource);
			expect(s3Client.putBucketLoggingCalled).to.be.true;
		});
		it(`calls PutBucketLogging if change from undefined`, async () => {
			const s3Client = new LoggingTestS3Client(undefined);
			const bucket = new S3Bucket({}, s3Client);
			const resource: KubernetesBucket = {
				metadata: {
					name: 'test',
				},
				spec: {
					loggingConfiguration: {
						destinationBucketName: 'bucket',
						logFilePrefix: 'prefix',
					},
				},
			};
			await bucket.update(resource);
			expect(s3Client.putBucketLoggingCalled).to.be.true;
		});
	});
});
