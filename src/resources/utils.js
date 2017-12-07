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

function capitalizeFieldNames(object) {
	if (!object || typeof object !== 'object') {
		return object;
	}

	return Object.keys(object).reduce((result, key) => {
		let value = object[key];
		if (Array.isArray(value)) {
			value = value.map(item => capitalizeFieldNames(item));
		} else if (typeof value === 'object') {
			value = capitalizeFieldNames(value);
		}

		result[capitalize(key)] = value;
		return result;
	}, {});
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

module.exports = {
	capitalize,
	capitalizeFieldNames,
	delay,
	isTransientNetworkError,
	md5
};

