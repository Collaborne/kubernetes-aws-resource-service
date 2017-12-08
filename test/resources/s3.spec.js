const chai = require('chai');
const expect = chai.expect;

const S3Bucket = require('../../src/resources/s3');

describe('s3', function utilsTest() {
	describe('_translateAttributes behavior', function capitalizeFieldNamesTest() {
		it('uppercase the acl field', () => {
			const s3 = new S3Bucket();
			const attributes = s3._translateAttributes({
				metadata: {
					name: 'TestBucket',
				},
				spec: {
					acl: 'public'
				}
			});
			expect(attributes.ACL).to.be.equal('public');
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
			const attributes = s3._translateAttributes({
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
});
