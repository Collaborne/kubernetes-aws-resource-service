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
	});
	describe('create behavior', () => {
		it('invokes update when the bucket exists for this account', done => {
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
			bucketHandler.create(bucket).then(result => {
				expect(result.updateInvoked).to.be.equal(bucket.metadata.name);
				done();
			});
		});
	});
});
