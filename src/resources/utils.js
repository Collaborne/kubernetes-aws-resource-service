/**
 * Determine whether the given error is a (likely) transient network error
 *
 * @param {AWSError|Error} err the error to check
 * @return {boolean} `true` if the provided error is a (likely) transient network error
 */
function isTransientNetworkError(err) {
	return err.code === 'NetworkingError' && (err.errno === 'EHOSTUNREACH' || err.errno === 'ECONNREFUSED');
}

module.exports = {
	isTransientNetworkError
};

