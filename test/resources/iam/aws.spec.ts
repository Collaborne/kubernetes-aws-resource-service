import { expect } from 'chai';
import 'mocha';

import { Tag } from 'aws-sdk/clients/iam';

import { IAMClient } from '../../../src/resources/iam/aws';

describe('IAMClient', () => {
	describe('updateRoleTags', () => {
		it('throws an error if listRoleTags returns truncated result', async () => {
			const iam = new IAMClient();
			iam.listRoleTags = async () => ({IsTruncated: true, Marker: 'test', Tags: []});
			try {
				await iam.updateRoleTags('test', []);
				expect.fail('Should throw');
			} catch (e) {
				// Good.
			}
		});
		it('removes all tags if tags is empty', async () => {
			const existingTags = [
				{Key: 'foo', Value: 'bar'},
			];
			const iam = new IAMClient();
			iam.listRoleTags = async () => ({IsTruncated: false, Marker: 'test', Tags: existingTags});
			const removedTagKeys: string[] = [];
			iam.untagRole = async (roleName, tagKeys) => {
				removedTagKeys.push(...tagKeys);
				return {};
			};
			iam.tagRole = async () => {
				throw new Error('Should not be called');
			};

			await iam.updateRoleTags('test', []);
			expect(removedTagKeys).to.be.deep.equal(['foo']);
		});
		it('removes missing tags', async () => {
			const existingTags = [
				{Key: 'foo', Value: 'bar'},
				{Key: 'keep', Value: 'value'},
			];
			const iam = new IAMClient();
			iam.listRoleTags = async () => ({IsTruncated: false, Marker: 'test', Tags: existingTags});
			const removedTagKeys: string[] = [];
			iam.untagRole = async (roleName, tagKeys) => {
				removedTagKeys.push(...tagKeys);
				return {};
			};
			iam.tagRole = async () => {
				throw new Error('Should not be called');
			};

			await iam.updateRoleTags('test', [{Key: 'keep', Value: 'value'}]);
			expect(removedTagKeys).to.be.deep.equal(['foo']);
		});
		it('adds new tags by key', async () => {
			const existingTags = [
				{Key: 'foo', Value: 'bar'},
			];
			const iam = new IAMClient();
			iam.listRoleTags = async () => ({IsTruncated: false, Marker: 'test', Tags: existingTags});
			const removedTagKeys: string[] = [];
			iam.untagRole = async (roleName, tagKeys) => {
				removedTagKeys.push(...tagKeys);
				return {};
			};
			const addedTags: Tag[] = [];
			iam.tagRole = async (roleName, tags) => {
				addedTags.push(...tags);
				return {};
			};

			await iam.updateRoleTags('test', [
				{Key: 'foo', Value: 'bar'},
				{Key: 'new', Value: 'value'},
			]);
			expect(removedTagKeys).to.be.deep.equal([]);
			expect(addedTags).to.be.deep.equal([{Key: 'new', Value: 'value'}]);
		});
		it('adds new tags by value', async () => {
			const existingTags = [
				{Key: 'foo', Value: 'bar'},
			];
			const iam = new IAMClient();
			iam.listRoleTags = async () => ({IsTruncated: false, Marker: 'test', Tags: existingTags});
			const removedTagKeys: string[] = [];
			iam.untagRole = async (roleName, tagKeys) => {
				removedTagKeys.push(...tagKeys);
				return {};
			};
			const addedTags: Tag[] = [];
			iam.tagRole = async (roleName, tags) => {
				addedTags.push(...tags);
				return {};
			};

			await iam.updateRoleTags('test', [
				{Key: 'foo', Value: 'baz'},
			]);
			expect(removedTagKeys).to.be.deep.equal([]);
			expect(addedTags).to.be.deep.equal([{Key: 'foo', Value: 'baz'}]);
		});
	});
});
