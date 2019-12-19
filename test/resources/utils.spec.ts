import { expect } from 'chai';
import 'mocha';

import * as utils from '../../src/resources/utils';
import { Policy } from '../../src/types/aws';

describe('utils', () => {
	describe('capitalizeFieldNames', () => {
		it('leaves undefined untouched', () => {
			expect(utils.capitalizeFieldNames(undefined)).to.be.undefined;
		});
		it('leaves null untouched', () => {
			expect(utils.capitalizeFieldNames(null)).to.be.null;
		});
		it('leaves strings untouched', () => {
			expect(utils.capitalizeFieldNames('foo')).to.be.equal('foo');
		});
		it('retains capitalized names', () => {
			const object = {Foo: 'bar'};
			expect(Object.keys(utils.capitalizeFieldNames(object))).to.be.deep.equal(['Foo']);
		});
		it('capitalizes objects in an array', () => {
			const object = {foo: [{bar: 'baz'}]};
			const capitalized = utils.capitalizeFieldNames(object);
			expect(Object.keys(capitalized.Foo[0])).to.be.deep.equal(['Bar']);
		});
		it('capitalizes objects in an array (root)', () => {
			const array = [{bar: 'baz'}];
			const capitalized = utils.capitalizeFieldNames(array);
			expect(capitalized.length).to.be.equal(1);
			expect(Object.keys(capitalized[0])).to.be.deep.equal(['Bar']);
		});
		it('invokes the provided recursion helper', () => {
			const object = {Foo: 'bar'};
			let called = false;
			const helper: utils.CapitalizeFieldNamesForPathHelper = (path, value, recurse) => {
				called = true;
				return utils.capitalizeFieldNamesForPath(path, value, recurse);
			};
			utils.capitalizeFieldNames(object, helper);
			expect(called).to.be.true;
		});
		it('provides the object path to the recursion helper', () => {
			const object = {Foo: {Bar: ['baz']}};
			let lastPath: string[] = [];
			const helper: utils.CapitalizeFieldNamesForPathHelper = (path, value, recurse) => {
				lastPath = path;
				return utils.capitalizeFieldNamesForPath(path, value, recurse);
			};
			utils.capitalizeFieldNames(object, helper);
			expect(lastPath).to.be.deep.equal(['Foo', 'Bar', '0']);
		});
	});

	describe('injectResourceArn', () => {
		it('injects Arn into all statements', () => {
			const policy: Policy = {
				Statement: [
					{
						Action: 'action1',
						Effect: 'Allow',
					},
					{
						Action: 'action2',
						Effect: 'Allow',
					},
				],
			};
			const result = utils.injectResourceArn(policy, 'arn');
			expect(result.Statement).to.be.of.length(2);

			result.Statement.forEach(statement => {
				expect(statement.Resource).to.be.equal('arn');
			});
		});
	});
});
