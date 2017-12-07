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
	});
});
