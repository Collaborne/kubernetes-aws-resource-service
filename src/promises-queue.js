class PromisesQueue {
	constructor() { // eslint-disable-line padded-blocks

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
		const nextPromise = previousPromise.then(next);

		this.promises[name] = nextPromise;
		return nextPromise;
	}
}

module.exports = PromisesQueue;
