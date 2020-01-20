import { expect } from 'chai';
import 'mocha';

import AWS from 'aws-sdk';
import { BucketLoggingStatus } from 'aws-sdk/clients/s3';
import { SinonStub, stub } from 'sinon';

import { S3Client } from '../../../src/resources/s3/aws';

type ElementType<T extends ReadonlyArray<unknown>> = T extends ReadonlyArray<infer E> ? E : never;

const STUBBED_OPERATIONS = [
	'deleteBucketLifecycle',
	'getBucketVersioning',
	'putBucketLogging',
	'putBucketVersioning',
	'putBucketTagging',
	'putBucketCors',
	'deleteBucketCors',
] as const;

function getAWSS3Prototype() {
	return AWS.S3.prototype;
}

function createAWSRequestWithResult<T>(result: T): AWS.Request<T, AWS.AWSError> {
	return {promise: () => Promise.resolve(result)} as AWS.Request<T, AWS.AWSError>;
}

function createS3Client(): {[operation in ElementType<typeof STUBBED_OPERATIONS>]: AWS.S3[operation] & SinonStub} & {s3Client: S3Client} {
	const originalOperations: {[operation: string]: any} = {};
	Object.defineProperty(AWS.S3, 'originalOperations', {value: originalOperations, enumerable: false, writable: true});

	const prototype = getAWSS3Prototype();
	const stubOperations: {[operation: string]: any} = {};
	for (const operation of STUBBED_OPERATIONS) {
		const dummyRequest = createAWSRequestWithResult(undefined);
		const stubOperation = stub().returns(dummyRequest);
		stubOperations[operation] = stubOperation;
		originalOperations[operation] = prototype[operation];
		prototype[operation] = stubOperation;
	}
	return {
		...stubOperations,
		s3Client: new S3Client(),
	} as ReturnType<typeof createS3Client>;
}

function resetAWSS3Prototype() {
	const prototype = getAWSS3Prototype();
	const originalOperations: {[operation: string]: any} = (AWS.S3 as any).originalOperations;
	Object.entries(originalOperations).forEach(([operation, originalOperation]) => {
		prototype[operation as ElementType<typeof STUBBED_OPERATIONS>] = originalOperation;
		delete originalOperations[operation];
	});
}

describe('S3Client', () => {
	afterEach(resetAWSS3Prototype);

	describe('putBucketLogging', () => {
		it('sets the bucket name', async () => {
			const {putBucketLogging, s3Client} = createS3Client();
			await s3Client.putBucketLogging('bucketName', {});
			expect(putBucketLogging.calledOnce);
			expect(putBucketLogging.lastCall.args[0]).to.have.ownProperty('Bucket', 'bucketName');
		});
		it('sets the status', async () => {
			const {putBucketLogging, s3Client} = createS3Client();

			const loggingStatus: BucketLoggingStatus = {
				LoggingEnabled: {
					TargetBucket: 'targetBucket',
					TargetPrefix: 'targetPrefix',
				},
			};
			await s3Client.putBucketLogging('bucketName', loggingStatus);
			expect(putBucketLogging.calledOnce);
			expect(putBucketLogging.lastCall.args[0]).to.be.deep.equal({Bucket: 'bucketName', BucketLoggingStatus: loggingStatus});
		});
		it('accepts an empty status', async () => {
			const {putBucketLogging, s3Client} = createS3Client();
			await s3Client.putBucketLogging('bucketName', {});
			expect(putBucketLogging.calledOnce);
			expect(putBucketLogging.lastCall.args[0]).to.be.deep.equal({Bucket: 'bucketName', BucketLoggingStatus: {}});
		});
		it('accepts a null status', async () => {
			const {putBucketLogging, s3Client} = createS3Client();
			await s3Client.putBucketLogging('bucketName', null);
			expect(putBucketLogging.calledOnce);
			expect(putBucketLogging.lastCall.args[0]).to.be.deep.equal({Bucket: 'bucketName', BucketLoggingStatus: {}});
		});
	});

	describe('putBucketVersioning', () => {
		it('null versioning for bucket without versioning is "no change"', async () => {
			const {getBucketVersioning, putBucketVersioning, s3Client} = createS3Client();
			getBucketVersioning.returns(createAWSRequestWithResult({}));
			await s3Client.putVersioningConfiguration('bucketName', null);
			expect(putBucketVersioning.called).to.be.false;
		});
		it('null versioning for bucket with enabled versioning is "Suspended"', async () => {
			const {getBucketVersioning, putBucketVersioning, s3Client} = createS3Client();
			getBucketVersioning.returns(createAWSRequestWithResult({Status: 'Enabled'}));
			await s3Client.putVersioningConfiguration('bucketName', null);
			expect(putBucketVersioning.calledOnce).to.be.true;
			expect(putBucketVersioning.lastCall.args[0]).to.be.deep.equal({
				Bucket: 'bucketName',
				VersioningConfiguration: {
					Status: 'Suspended',
				},
			});
		});
		['Enabled', 'Suspended'].forEach(status => {
			it(`sets versioning status to ${status} for unconfigured bucket`, async () => {
				const {getBucketVersioning, putBucketVersioning, s3Client} = createS3Client();
				getBucketVersioning.returns(createAWSRequestWithResult({}));
				await s3Client.putVersioningConfiguration('bucketName', {Status: status});
				expect(putBucketVersioning.calledOnce).to.be.true;
				expect(putBucketVersioning.lastCall.args[0]).to.be.deep.equal({
					Bucket: 'bucketName',
					VersioningConfiguration: {
						Status: status,
					},
				});
			});
		});
	});

	describe('putTagging', () => {
		it('sets tags to empty for null', async () => {
			const {putBucketTagging, s3Client} = createS3Client();
			await s3Client.putTagging('bucketName', null);
			expect(putBucketTagging.calledOnce).to.be.true;
			expect(putBucketTagging.lastCall.args[0]).to.be.deep.equal({
				Bucket: 'bucketName',
				Tagging: {
					TagSet: [],
				},
			});
		});
		it('sets tags', async () => {
			const tags = [{Key: 'foo', Value: 'bar'}];
			const {putBucketTagging, s3Client} = createS3Client();
			await s3Client.putTagging('bucketName', tags);
			expect(putBucketTagging.calledOnce).to.be.true;
			expect(putBucketTagging.lastCall.args[0]).to.be.deep.equal({
				Bucket: 'bucketName',
				Tagging: {
					TagSet: tags,
				},
			});
		});
	});

	describe('deleteLifecycleConfiguration', () => {
		it('sets the bucket name', async () => {
			const {deleteBucketLifecycle, s3Client} = createS3Client();
			await s3Client.deleteLifecycleConfiguration('bucketName');
			expect(deleteBucketLifecycle.calledOnce).to.be.true;
			expect(deleteBucketLifecycle.lastCall.args[0]).to.be.deep.equal({Bucket: 'bucketName'});
		});
	});

	describe('putBucketCorsRules', () => {
		it('sets the rules', async () => {
			const rules = [
				{ Id: 'rule1', AllowedMethods: ['GET'], AllowedOrigins: ['*'] },
			];
			const {putBucketCors, s3Client} = createS3Client();
			await s3Client.putBucketCorsRules('bucketName', rules);
			expect(putBucketCors.calledOnce).to.be.true;
			expect(putBucketCors.lastCall.args[0]).to.deep.contain({
				CORSConfiguration: {
					CORSRules: rules,
				},
			});
		});
	});

	describe('deleteBucketCorsRules', () => {
		it('sets the bucket name', async () => {
			const {deleteBucketCors, s3Client} = createS3Client();
			await s3Client.deleteBucketCorsRules('bucketName');
			expect(deleteBucketCors.calledOnce).to.be.true;
			expect(deleteBucketCors.lastCall.args[0]).to.be.deep.equal({Bucket: 'bucketName'});
		});
	});
});
