const chai = require('chai');
const expect = chai.expect;

const utils = require('../../src/resources/utils');

describe('utils', function utilsTest() {
	describe('capitalizeFieldNames', function capitalizeFieldNamesTest() {
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
			const helper = (path, value, recurse) => {
				called = true;
				return utils.capitalizeFieldNamesForPath(path, value, recurse);
			};
			utils.capitalizeFieldNames(object, helper);
			expect(called).to.be.true;
		});
		it('provides the object path to the recursion helper', () => {
			const object = {Foo: {Bar: ['baz']}};
			let lastPath = [];
			const helper = (path, value, recurse) => {
				lastPath = path;
				return utils.capitalizeFieldNamesForPath(path, value, recurse);
			};
			utils.capitalizeFieldNames(object, helper);
			expect(lastPath).to.be.deep.equal(['Foo', 'Bar', '0']);
		});
	});
});
