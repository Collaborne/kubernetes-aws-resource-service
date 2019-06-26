const crypto = require('crypto');

/**
 * Determine whether the given error is a (likely) transient network error
 *
 * @param {AWSError|Error} err the error to check
 * @return {boolean} `true` if the provided error is a (likely) transient network error
 */
function isTransientNetworkError(err) {
	return err.code === 'NetworkingError' && (err.errno === 'EHOSTUNREACH' || err.errno === 'ECONNREFUSED');
}

/**
 * Capitalize the given string `s`
 *
 * @param {String} s the string to capitalize
 * @return {String} `s` capitalized
 */
function capitalize(s) {
	return s[0].toUpperCase() + s.substring(1);
}

function capitalizeFieldNamesForPath(path, object, recurse) {
	if (!object || typeof object !== 'object') {
		return object;
	}

	return Object.keys(object).reduce((result, key) => {
		result[capitalize(key)] = recurse(path.concat([key]), object[key], recurse);
		return result;
	}, Array.isArray(object) ? [] : {});
}

/**
 * Capitalize all field names recursively in a given object.
 *
 * When the provided `object` is not actually an object it will be returned unmodified.
 *
 * @param {any} object the object to work on
 * @param {*} [capitalizeFieldNamesForPathHelper] recursion helper function, defaults to `capitalizeFieldNamesForPath`
 * @return {any} the incoming object with field names recursively capitalized
 */
function capitalizeFieldNames(object, capitalizeFieldNamesForPathHelper) {
	// NB: We cannot use default parameters here, as these get evaluated at the call-site, where the helper may not be imported.
	const helper = capitalizeFieldNamesForPathHelper || capitalizeFieldNamesForPath;
	return helper([], object, helper);
}

function md5(data) {
	return crypto.createHash('md5').update(data).digest('hex');
}

/**
 * Resolve a promise after the `timeout` has passed.
 *
 * @param {Number} after timeout in milliseconds
 * @return {Promise<void>} promise resolved after timeout
 */
function delay(after) {
	return new Promise(resolve => {
		return setTimeout(() => {
			return resolve();
		}, after);
	});
}

/* eslint-disable valid-jsdoc */
/**
 * Inject the bucket ARN as 'Resource' into all statements of the policy
 *
 * @param {Object} policy a AWS policy
 * @param {String} [resourceArn] a ARN to attempt to inject
 * @return {Object} the policy, with the ARN injected if possible
 */
/* eslint-enable valid-jsdoc */
function injectResourceArn(policy, resourceArn) {
	if (!resourceArn) {
		return policy;
	}

	const newStatement = (policy.Statement || []).map(statement => Object.assign({Resource: resourceArn}, statement));
	return Object.assign({}, policy, {
		Statement: newStatement,
	});
}

module.exports = {
	capitalize,
	capitalizeFieldNames,
	capitalizeFieldNamesForPath,
	delay,
	injectResourceArn,
	isTransientNetworkError,
	md5
};

