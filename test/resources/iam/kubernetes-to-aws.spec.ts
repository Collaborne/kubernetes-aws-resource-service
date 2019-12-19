import { expect } from 'chai';
import 'mocha';

import { translateAttributes } from '../../../src/resources/iam/kubernetes-to-aws';
import { Effect } from '../../../src/types/aws';

describe('iam/kubernetes-to-aws.spec', function utilsTest() {
	describe('translateAttributes behavior', () => {
		it('doesn\'t change the operand of conditions', () => {
			const attributes = translateAttributes({
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
											'ses:FromAddress': 'me@example.com',
										},
									},
									effect: 'Allow' as Effect,
									resource: '*',
								},
							],
						},
					],
				},
			});
			expect(attributes.policies).to.be.deep.equal([
				{
					Statement: [
						{
							Action: ['ses:SendRawEmail'],
							Condition: {
								StringEquals: {
									'ses:FromAddress': 'me@example.com',
								},
							},
							Effect: 'Allow',
							Resource: '*',
						},
					],
				},
			]);
		});
	});
});