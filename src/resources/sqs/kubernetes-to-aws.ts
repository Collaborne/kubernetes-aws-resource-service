import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';
import { capitalize, capitalizeFieldNames, injectResourceArn } from '../utils';
import { KubernetesQueue } from './kubernetes-config';

const logger = getLogger('sqs/kubernetes-to-aws');

/**
 * Convert the queue.spec parts from camelCase to AWS CapitalCase.
 *
 * @param queue a queue definition
 * @param queueArn the ARN of the queue
 * @return the queue attributes
 */
export function translateAttributes(queue: KubernetesQueue, queueArn?: string): {[key: string]: string} {
	return Object.keys(queue.spec || {}).reduce((result, key) => {
		const value = queue.spec[key];
		let resultValue: string;
		switch (key) {
		case 'redrivePolicy':
			resultValue = JSON.stringify(capitalizeFieldNames(value));
			break;
		case 'policy':
			resultValue = JSON.stringify(injectQueueArn(queue.metadata.name, capitalizeFieldNames(value), queueArn));
			break;
		default:
			// Convert to string
			resultValue = `${value}`;
			break;
		}
		logger.debug(`[${queue.metadata.name}]: Attribute ${key} = ${resultValue}`);

		result[capitalize(key)] = resultValue;
		return result;
	}, {} as {[key: string]: string});
}

/**
 * Inject the queue ARN as 'Resource' into all statements of the policy
 *
 * @param queueName name of the queue
 * @param policy a policy
 * @param [queueArn] a queue ARN to attempt to inject
 * @return the policy, with the ARN injected if possible
 */
function injectQueueArn(queueName: string, policy: Policy, queueArn?: string): Policy {
	if (!queueArn) {
		return policy;
	}

	logger.debug(`[${queueName}]: Injecting resource ARN ${queueArn} into policy document`);
	return injectResourceArn(policy, queueArn);
}
