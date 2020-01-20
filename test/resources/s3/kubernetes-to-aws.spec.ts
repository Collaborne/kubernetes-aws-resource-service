import { expect } from 'chai';
import 'mocha';

import { CORSRule } from 'aws-sdk/clients/s3';

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
					Statement: [],
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
					Statement: [
						{
							Action: '*',
							Effect: 'Allow',
							Resource: 'arn:aws:s3:::TestBucket',
						},
					],
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
					Statement: [
						{
							Action: '*',
							Effect: 'Allow',
							Resource: 'arn:something',
						},
					],
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
					Statement: [
						{
							Action: '*',
							Effect: 'Allow',
							Principal: {
								AWS: 'principal',
							},
							Resource: 'arn:aws:s3:::TestBucket',
						},
					],
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
					Rules: [
						{
							ApplyServerSideEncryptionByDefault: {
								KMSMasterKeyId: 'kmsMasterKeyId',
								SSEAlgorithm: 'aws:kms',
							},
						},
					],
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
					Rules: [
						{
							ApplyServerSideEncryptionByDefault: {
								SSEAlgorithm: 'AES256',
							},
						},
					],
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
					BlockPublicAcls: true,
					BlockPublicPolicy: true,
					IgnorePublicAcls: true,
					RestrictPublicBuckets: true,
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
					Status: 'Enabled',
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

		describe('CORS Configuration', () => {
			it('translates empty CORS configuration', () => {
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						corsConfiguration: {
							corsRules: [],
						},
					},
				});
				expect(corsRules).to.have.lengthOf(0);
			});
			it('translates CORS configuration', () => {
				const expectedRules: CORSRule[] = [
					{
						AllowedHeaders: undefined,
						AllowedMethods: ['GET'],
						AllowedOrigins: ['*'],
						ExposeHeaders: undefined,
						MaxAgeSeconds: undefined,
					},
					{
						AllowedHeaders: undefined,
						AllowedMethods: ['POST'],
						AllowedOrigins: ['https://www.example.com'],
						ExposeHeaders: undefined,
						MaxAgeSeconds: undefined,
					},
				];
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						corsConfiguration: {
							corsRules: [
								{ id: 'rule1', allowedMethods: ['GET'], allowedOrigins: ['*'] },
								{ id: 'rule2', allowedMethods: ['POST'], allowedOrigins: ['https://www.example.com'] },
							],
						},
					},
				});
				expect(corsRules).to.not.be.null;
				corsRules!.forEach((corsRule, index) => {
					expect(corsRule).to.be.deep.equal(expectedRules[index]);
				});
			});
			it('translates CORS rule with max age', () => {
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						corsConfiguration: {
							corsRules: [
								{ id: 'rule1', maxAge: 20 },
							],
						},
					},
				});
				expect(corsRules).to.not.be.null;
				expect(corsRules![0]).to.have.ownProperty('MaxAgeSeconds', 20);
			});
			it('translates CORS rule with exposed headers', () => {
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						corsConfiguration: {
							corsRules: [
								{ id: 'rule1', exposedHeaders: ['foo'] },
							],
						},
					},
				});
				expect(corsRules).to.not.be.null;
				expect(corsRules![0]).to.deep.contain({
					ExposeHeaders: ['foo'],
				});
			});
			it('drops ids', () => {
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						corsConfiguration: {
							corsRules: [
								{ id: 'rule1', maxAge: 20 },
							],
						},
					},
				});
				expect(corsRules).to.not.be.null;
				expect(corsRules![0]).to.not.have.ownProperty('Id');
			});
			it('returns null for missing CORS configuration', () => {
				const {corsRules} = translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(corsRules).to.be.null;
			});
		});

		describe('Tags', () => {
			it('translates tags', () => {
				const expected = [
					{
						Key: 'Environment',
						Value: 'master',
					},
				];
				const {tags} = translateSpec({
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
				expect(tags).to.be.deep.equals(expected);
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
