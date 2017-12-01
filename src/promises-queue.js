class PromisesQueue {
	constructor() {
		/**
		 * Known promises for queues, used to synchronize requests and avoid races between delayed creations and modifications.
		 *
		 * @type {Object.<string,Promise<any>>}
		 */
		this.promises = {};
	}

	enqueue(name, next) {
		// Enqueue the request to happen when the previous request is done.
		const previousPromise = this.promises[name] || Promise.resolve();

		return this.promises[name] = previousPromise.then(next);
	}
};

module.exports = PromisesQueue;
