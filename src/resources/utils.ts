import { AWSError } from 'aws-sdk';
import crypto from 'crypto';
import { getLogger } from 'log4js';

import { AWSOperation, Policy } from '../types/aws';

const logger = getLogger();

export type CapitalizeFieldNamesForPathHelper = (
	path: string[],
	object: any,
	recurse: CapitalizeFieldNamesForPathHelper,
	capitalizeFieldName: CapitalizeFieldName) => any;
export type CapitalizeFieldName = (s: string) => string;

export interface NetworkError extends AWSError {
	errno: string;
}

/**
 * Determine whether the given error is a (likely) transient network error
 *
 * @param err the error to check
 * @return `true` if the provided error is a (likely) transient network error
 */
export function isTransientNetworkError(err: NetworkError): boolean {
	return err.code === 'NetworkingError' && (err.errno === 'EHOSTUNREACH' || err.errno === 'ECONNREFUSED');
}

/**
 * Capitalize the given string `s`
 *
 * @param s the string to capitalize
 * @return `s` capitalized
 */
export function capitalize(s: string): string {
	return s[0].toUpperCase() + s.substring(1);
}

export function capitalizeFieldNamesForPath(
	path: string[],
	object: any,
	recurse: CapitalizeFieldNamesForPathHelper,
	capitalizeFieldName: CapitalizeFieldName) {
	if (!object || typeof object !== 'object') {
		return object;
	}

	return Object.keys(object).reduce((result: any, key) => {
		result[capitalizeFieldName(key)] = recurse(path.concat([key]), object[key], recurse, capitalizeFieldName);
		return result;
	}, Array.isArray(object) ? [] : {});
}

/**
 * Capitalize all field names recursively in a given object.
 *
 * When the provided `object` is not actually an object it will be returned unmodified.
 *
 * @param object the object to work on
 * @param [capitalizeFieldNamesForPathHelper] recursion helper function, defaults to `capitalizeFieldNamesForPath`
 * @return the incoming object with field names recursively capitalized
 */
export function capitalizeFieldNames(
	object: any,
	capitalizeFieldNamesForPathHelper?: CapitalizeFieldNamesForPathHelper,
	capitalizeFieldName?: CapitalizeFieldName): any {
	// NB: We cannot use default parameters here, as these get evaluated at the call-site, where the helper may not be imported.
	const helper = capitalizeFieldNamesForPathHelper || capitalizeFieldNamesForPath;
	const capitalizer = capitalizeFieldName || capitalize;
	return helper([], object, helper, capitalizer);
}

export function md5(data: crypto.BinaryLike) {
	return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Resolve a promise after the `timeout` has passed.
 *
 * @param after timeout in milliseconds
 * @return promise resolved after timeout
 */
export function delay(after: number): Promise<void> {
	return new Promise(resolve => {
		return setTimeout(() => {
			return resolve();
		}, after);
	});
}

/**
 * Inject the bucket ARN as 'Resource' into all statements of the policy
 *
 * @param policy a AWS policy
 * @param a ARN to attempt to inject
 * @return the policy, with the ARN injected if possible
 */
export function injectResourceArn(policy: Policy, resourceArn?: string): Policy {
	if (!resourceArn) {
		return policy;
	}

	const newStatement = (policy.Statement || []).map(statement => ({
		Resource: resourceArn,
		...statement,
	}));
	return {
		...policy,
		Statement: newStatement,
	};
}

function isAwsError(obj: any) {
	return Boolean(obj.code) && Boolean(obj.message);
}

export async function retryOnTransientNetworkErrors<T>(logName: string, awsOperation: () => AWSOperation<T>): Promise<T> {
	const errorRetryDelay = 30000;
	try {
		const response = await awsOperation().promise();
		if (isAwsError(response)) {
			logger.warn(`[${logName}]: received error response: ${JSON.stringify(response)}`);
			throw response;
		}
		return response;
	} catch (err) {
		if (isTransientNetworkError(err)) {
			logger.warn(`[${logName}]: transient ${err.code} ${err.errno}, retrying in ${errorRetryDelay / 1000}s`);
			await delay(errorRetryDelay);
			return retryOnTransientNetworkErrors(logName, awsOperation);
		}

		logger.warn(`[${logName}]: non-retryable error in operation: ${err.message}`);

		throw err;
	}
}
