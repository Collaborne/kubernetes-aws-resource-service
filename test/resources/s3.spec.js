const chai = require('chai');
const expect = chai.expect;

const S3Bucket = require('../../src/resources/s3');

describe('s3', function utilsTest() {
	describe('_translateSpec behavior', () => {
		it('uppercase the acl field', () => {
			const s3 = new S3Bucket();
			const {attributes} = s3._translateSpec({
				metadata: {
					name: 'TestBucket',
				},
				spec: {
					acl: 'public-read'
				}
			});
			expect(attributes.ACL).to.be.equal('public-read');
		});
		it('translates all fields', () => {
			const s3 = new S3Bucket();
			const expectedResult = {
				ACL: 'private',
				CreateBucketConfiguration: {
					LocationConstraint: 'EU'
				},
				GrantFullControl: 'grantFullControl',
				GrantRead: 'grantRead',
				GrantReadACP: 'grantReadACP',
				GrantWrite: 'grantWrite',
				GrantWriteACP: 'grantWriteACP'
			};
			const {attributes} = s3._translateSpec({
				metadata: {
					name: 'TestBucket',
				},
				spec: {
					acl: 'private',
					createBucketConfiguration: {
						locationConstraint: 'EU'
					},
					grantFullControl: 'grantFullControl',
					grantRead: 'grantRead',
					grantReadACP: 'grantReadACP',
					grantWrite: 'grantWrite',
					grantWriteACP: 'grantWriteACP'
				}
			});
			expect(attributes).to.be.deep.equal(expectedResult);
		});

		describe('Bucket policy', () => {
			it('translates bucket policy', () => {
				const s3 = new S3Bucket();
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[]}',
				};
				const {policy} = s3._translateSpec({
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
				const s3 = new S3Bucket();
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:aws:s3:::TestBucket","Action":"*","Effect":"Allow"}]}',
				};
				const {policy} = s3._translateSpec({
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
				const s3 = new S3Bucket();
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:something","Action":"*","Effect":"Allow"}]}',
				};
				const {policy} = s3._translateSpec({
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
				const s3 = new S3Bucket();
				const expectedPolicy = {
					Bucket: 'TestBucket',
					ConfirmRemoveSelfBucketAccess: false,
					Policy: '{"Statement":[{"Resource":"arn:aws:s3:::TestBucket","Action":"*","Effect":"Allow","Principal":{"AWS":"principal"}}]}',
				};
				const {policy} = s3._translateSpec({
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
									}
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
				const s3 = new S3Bucket();
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
				const {sseParams} = s3._translateSpec({
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
					}
				});
				expect(sseParams).to.be.deep.equal(expectedResult);
			});
			it('translates bucket-encryption fields (AES256)', () => {
				const s3 = new S3Bucket();
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
				const {sseParams} = s3._translateSpec({
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
					}
				});
				expect(sseParams).to.be.deep.equal(expectedResult);
			});
			it('rejects bucket-encryption fields (AES256) with KMS master key', () => {
				const s3 = new S3Bucket();
				expect(() => s3._translateSpec({
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
					}
				})).to.throw();
			});
			it('rejects bucket-encryption fields (unknown algorithm)', () => {
				const s3 = new S3Bucket();
				expect(() => s3._translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [
								{
									serverSideEncryptionByDefault: {
										sseAlgorithm: 'unknown',
									},
								},
							],
						},
					}
				})).to.throw();
			});
			it('returns null for missing bucket encryption', () => {
				const s3 = new S3Bucket();
				const {sseParams} = s3._translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {}
				});
				expect(sseParams).to.be.null;
			});
			it('returns null for empty bucket encryption', () => {
				const s3 = new S3Bucket();
				const {sseParams} = s3._translateSpec({
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
				const s3 = new S3Bucket();
				const {sseParams} = s3._translateSpec({
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
				const s3 = new S3Bucket();
				expect(() => s3._translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {
						bucketEncryption: {
							serverSideEncryptionConfiguration: [{}],
						},
					},
				})).to.throw();
			});
		});

		describe('Public Access Block', () => {
			it('translates Public Access Block configuration', () => {
				const s3 = new S3Bucket();
				const expectedResult = {
					Bucket: 'TestBucket',
					PublicAccessBlockConfiguration: {
						BlockPublicAcls: true,
						BlockPublicPolicy: true,
						IgnorePublicAcls: true,
						RestrictPublicBuckets: true,
					},
				};
				const {publicAccessBlockParams} = s3._translateSpec({
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
					}
				});
				expect(publicAccessBlockParams).to.be.deep.equal(expectedResult);
			});
			it('returns null for missing Public Access Block configuration', () => {
				const s3 = new S3Bucket();
				const {publicAccessBlockParams} = s3._translateSpec({
					metadata: {
						name: 'TestBucket',
					},
					spec: {},
				});
				expect(publicAccessBlockParams).to.be.null;
			});
		});
	});
	describe('create behavior', () => {
		it('invokes update when the bucket exists for this account', async() => {
			class TestS3Bucket extends S3Bucket {
				update(bucket) {
					return Promise.resolve({updateInvoked: bucket.metadata.name});
				}

				_createBucket(bucketName, attributes) { // eslint-disable-line no-unused-vars
					const err = new Error(`Simulating ${bucketName} already owned by current account`);
					err.name = 'BucketAlreadyOwnedByYou';
					return Promise.reject(err);
				}
			}

			const bucket = {
				metadata: {
					name: 'test-bucket'
				},
				spec: {}
			};
			const bucketHandler = new TestS3Bucket();
			const result = await bucketHandler.create(bucket);
			expect(result.updateInvoked).to.be.equal(bucket.metadata.name);
		});
	});
});
