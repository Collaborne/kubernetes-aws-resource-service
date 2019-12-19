import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';

import { capitalize, capitalizeFieldNames, capitalizeFieldNamesForPath, CapitalizeFieldNamesForPathHelper } from '../utils';
import { KubernetesRole } from './kubernetes-config';

const logger = getLogger('iam/kubernetes-to-aws');

interface TranslateAttributesResult {
	attributes: {[key: string]: any};
	policies: Policy[];
	policyArns: string[];
}

/**
 * Convert the resource.spec parts from camelCase to AWS CapitalCase.
 *
 * @param resource a resource definition
 * @return the queue attributes
 */
export function translateAttributes(resource: KubernetesRole): TranslateAttributesResult {
	const policies: Policy[] = [];
	const policyArns: string[] = [];
	const attributes = Object.keys(resource.spec || {}).reduce((result, key) => {
		const value = resource.spec[key];

		let resultValue;
		switch (key) {
		case 'policies':
			(value as Policy[]).map(policy => capitalizeFieldNames(policy, capitalizeFieldNamesForPathExceptCondition)).forEach(policy => policies.push(policy));
			// Don't process this further: 'policies' does not actually belong into an IAM::Role.
			return result;
		case 'policyArns':
			(value as string[]).forEach(policyArn => policyArns.push(policyArn));
			// Don't process this further: 'policyArns' does not actually belong into an IAM::Role.
			return result;
		case 'assumeRolePolicyDocument':
			// Apply the default version if it is missing. This simplifies later comparisions of these values.
			// See http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_version.html
			resultValue = JSON.stringify(Object.assign({Version: '2008-10-17'}, capitalizeFieldNames(value, capitalizeFieldNamesForPathExceptCondition)));
			break;
		default:
			// Convert to string
			resultValue = `${value}`;
			break;
		}
		logger.debug(`[${resource.metadata.name}]: Attribute ${key} = ${resultValue}`);

		result[capitalize(key)] = resultValue;
		return result;
	}, {} as {[key: string]: any});

	return {
		attributes,
		policies,
		policyArns,
	};
}

function capitalizeFieldNamesForPathExceptCondition(path: string[], object: any, recurse: CapitalizeFieldNamesForPathHelper) {
	if (path.length > 0 && capitalize(path[path.length - 1]) === 'Condition') {
		return object;
	}

	return capitalizeFieldNamesForPath(path, object, recurse);
}
