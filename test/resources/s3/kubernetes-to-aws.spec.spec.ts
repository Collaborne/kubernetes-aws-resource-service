import { PutBucketTaggingRequest } from 'aws-sdk/clients/s3';
import { expect } from 'chai';
import 'mocha';

import { S3Client } from '../../../src/resources/s3/aws';
import { KubernetesBucket } from '../../../src/resources/s3/kubernetes-config';
import { translateSpec } from '../../../src/resources/s3/kubernetes-to-aws';
import { S3Bucket } from '../../../src/resources/s3/s3';

// tslint:disable max-classes-per-file

describe('s3', function utilsTest() {
	describe('translateSpec behavior', () => {
		it('uppercase the acl field', () => {
			const {attributes} = translateSpec({
				metadata: {
					name: 'TestBucket',
				},
				spec: {
					acl: 'public-read',
				},
			});
			expect(attributes.ACL).to.be.equal('public-read');
		});
		it('translates all fields', () => {
			const expectedResult = {
				ACL: 'private',
				CreateBucketConfiguration: {
					LocationConstraint: 'EU',
				},
				GrantFullControl: 'grantFullControl',
				GrantRead: 'grantRead',
				GrantReadACP: 'grantReadACP',
				GrantWrite: 'grantWrite',
				GrantWriteACP: 'grantWriteACP',
			};
			const {attributes} = translateSpec({
				metadata: {
					name: 'TestBucket',
				},
				spec: {
					acl: 'private',
					createBucketConfiguration: {
						locationConstraint: 'EU',
					},
					grantFullControl: 'grantFullControl',
					grantRead: 'grantRead',
					grantReadACP: 'grantReadACP',
					grantWrite: 'grantWrite',
					grantWriteACP: 'grantWriteACP',
				},
			});
			expect(attributes).to.be.deep.equal(expectedResult);
		});

		describe('Bucket policy', () => {
			it('translates bucket policy', () => {
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[]}',
				};
				const {policy} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						policy: {
							statement: [],
						},
					},
				});
				expect(policy).to.be.deep.equals(expectedPolicy);
			});
			it('injects bucket ARN into policy statements', () => {
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:aws:s3:::TestBucket","Action":"*","Effect":"Allow"}]}',
				};
				const {policy} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						policy: {
							statement: [
								{
									action: '*',
									effect: 'Allow',
								},
							],
						},
					},
				});
				expect(policy).to.be.deep.equals(expectedPolicy);
			});
			it('retains defined resources in policy statements', () => {
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:something","Action":"*","Effect":"Allow"}]}',
				};
				const {policy} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						policy: {
							statement: [
								{
									action: '*',
									effect: 'Allow',
									resource: 'arn:something',
								},
							],
						},
					},
				});
				expect(policy).to.be.deep.equals(expectedPolicy);
			});
			it('translates "AWS" principals', () => {
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:aws:s3:::TestBucket","Action":"*","Effect":"Allow","Principal":{"AWS":"principal"}}]}',
				};
				const {policy} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						policy: {
							statement: [
								{
									action: '*',
									effect: 'Allow',
									principal: {
										AWS: 'principal',
									},
								},
							],
						},
					},
				});
				expect(policy).to.be.deep.equals(expectedPolicy);
			});
		});

		describe('Bucket encryption', () => {
			it('translates bucket-encryption fields (KMS)', () => {
				const expectedResult = {
					Bucket: 'TestBucket',
					ServerSideEncryptionConfiguration: {
						Rules: [
							{
								ApplyServerSideEncryptionByDefault: {
									KMSMasterKeyId: 'kmsMasterKeyId',
									SSEAlgorithm: 'aws:kms',
								},
							},
						],
					},
				};
				const {sseParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{
									serverSideEncryptionByDefault: {
										kmsMasterKeyId: 'kmsMasterKeyId',
										sseAlgorithm: 'aws:kms',
									},
								},
							],
						},
					},
				});
				expect(sseParams).to.be.deep.equal(expectedResult);
			});
			it('translates bucket-encryption fields (AES256)', () => {
				const expectedResult = {
					Bucket: 'TestBucket',
					ServerSideEncryptionConfiguration: {
						Rules: [
							{
								ApplyServerSideEncryptionByDefault: {
									SSEAlgorithm: 'AES256',
								},
							},
						],
					},
				};
				const {sseParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{
									serverSideEncryptionByDefault: {
										sseAlgorithm: 'AES256',
									},
								},
							],
						},
					},
				});
				expect(sseParams).to.be.deep.equal(expectedResult);
			});
			it('rejects bucket-encryption fields (AES256) with KMS master key', () => {
				expect(() => translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{
									serverSideEncryptionByDefault: {
										kmsMasterKeyId: 'kmsMasterKeyId',
										sseAlgorithm: 'AES256',
									},
								},
							],
						},
					},
				})).to.throw();
			});
			it('rejects bucket-encryption fields (unknown algorithm)', () => {
				expect(() => translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{
									serverSideEncryptionByDefault: {
										sseAlgorithm: 'unknown' as any,
									},
								},
							],
						},
					},
				})).to.throw();
			});
			it('returns null for missing bucket encryption', () => {
				const {sseParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(sseParams).to.be.null;
			});
			it('returns null for empty bucket encryption', () => {
				const {sseParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {},
					},
				});
				expect(sseParams).to.be.null;
			});
			it('returns null for empty bucket SSE configuration', () => {
				const {sseParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [],
						},
					},
				});
				expect(sseParams).to.be.null;
			});
			it('throws for invalid empty bucket SSE configuration rule', () => {
				expect(() => translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{} as any,
							],
						},
					},
				})).to.throw();
			});
		});

		describe('Public Access Block', () => {
			it('translates Public Access Block configuration', () => {
				const expectedResult = {
					Bucket: 'TestBucket',
					PublicAccessBlockConfiguration: {
						BlockPublicAcls: true,
						BlockPublicPolicy: true,
						IgnorePublicAcls: true,
						RestrictPublicBuckets: true,
					},
				};
				const {publicAccessBlockParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						publicAccessBlockConfiguration: {
							blockPublicAcls: true,
							blockPublicPolicy: true,
							ignorePublicAcls: true,
							restrictPublicBuckets: true,
						},
					},
				});
				expect(publicAccessBlockParams).to.be.deep.equal(expectedResult);
			});
			it('returns null for missing Public Access Block configuration', () => {
				const {publicAccessBlockParams} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(publicAccessBlockParams).to.be.null;
			});
		});

		describe('Versioning Configuration', () => {
			it('translates Versioning configuration', () => {
				const expectedResult = {
					Bucket: 'TestBucket',
					VersioningConfiguration: {
						Status: 'Enabled',
					},
				};
				const {versioningConfiguration} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						versioningConfiguration: {
							status: 'Enabled',
						},
					},
				});
				expect(versioningConfiguration).to.be.deep.equal(expectedResult);
			});
			it('returns null for missing Versioning configuration', () => {
				const {versioningConfiguration} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(versioningConfiguration).to.be.null;
			});
		});

		describe('Lifecycle Configuration', () => {
			it('translates Lifecycle Configuration', () => {
				const expectedResult = {
					Bucket: 'TestBucket',
					LifecycleConfiguration: {
						Rules: [
							{
								AbortIncompleteMultipartUpload: {
									DaysAfterInitiation: 7,
								},
								ID: 'Test Rule',
								Prefix: '',
								Status: 'Enabled',
							},
						],
					},
				};
				const {lifecycleConfiguration} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						lifecycleConfiguration: {
							rules: [
								{
									abortIncompleteMultipartUpload: {
										daysAfterInitiation: 7,
									},
									id: 'Test Rule',
									prefix: '',
									status: 'Enabled',
								},
							],
						},
					},
				});
				expect(lifecycleConfiguration).to.be.deep.equal(expectedResult);
			});
			it('returns null for missing lifecycle Configuration', () => {
				const {lifecycleConfiguration} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(lifecycleConfiguration).to.be.null;
			});
		});

		describe('Group Resource tagging', () => {
			it('translates tagging spec', () => {
				const expected: PutBucketTaggingRequest = {
					Bucket: 'TestBucket',
					Tagging: {
						TagSet: [
							{
								Key: 'Environment',
								Value: 'master',
							},
						],
					},
				};
				const {tags: tagging} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						tags: [
							{
								key: 'Environment',
								value: 'master',
							},
						],
					},
				});
				expect(tagging).to.be.deep.equals(expected);
			});
		});
	});
	describe('create behavior', () => {
		it('invokes update when the bucket exists for this account', async () => {
			class TestS3Bucket extends S3Bucket {
				public update(bucketParam: KubernetesBucket) {
					return Promise.resolve({updateInvoked: bucketParam.metadata.name});
				}
			}

			class S3ClientMock extends S3Client {
				public createBucket(bucketName: string) {
					const err = new Error(`Simulating ${bucketName} already owned by current account`);
					err.name = 'BucketAlreadyOwnedByYou';
					return Promise.reject(err);
				}
			}

			const bucket = {
				metadata: {
					name: 'test-bucket',
				},
				spec: {},
			};
			const bucketHandler = new TestS3Bucket({}, new S3ClientMock());
			const result = await bucketHandler.create(bucket);
			expect(result.updateInvoked).to.be.equal(bucket.metadata.name);
		});
	});
});
