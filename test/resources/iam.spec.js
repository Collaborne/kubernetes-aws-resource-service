const chai = require('chai');
const expect = chai.expect;

const IAMRole = require('../../src/resources/iam');

describe('iam', function utilsTest() {
	describe('_translateAttributes behavior', () => {
		it('doesn\'t change the operand of conditions', () => {
			const iamRole = new IAMRole();
			const attributes = iamRole._translateAttributes({
				metadata: {
					name: 'TestRole',
				},
				spec: {
					policies: [
						{
							statement: [
								{
									action: ['ses:SendRawEmail'],
									condition: {
										StringEquals: {
											'ses:FromAddress': 'me@example.com'
										}
									},
									effect: 'Allow',
									resource: '*',
								}
							]
						}
					]
				}
			});
			expect(attributes.policies).to.be.deep.equal([
				{
					Statement: [
						{
							Action: ['ses:SendRawEmail'],
							Condition: {
								StringEquals: {
									'ses:FromAddress': 'me@example.com'
								}
							},
							Effect: 'Allow',
							Resource: '*',
						}
					]
				}
			]);
		});
	});
});
