export class PromisesQueue {
	/**
	 * Known promises for queues, used to synchronize requests and avoid races between delayed creations and modifications.
	 */
	private promises: {[key: string]: Promise<any>} = {};

	public enqueue(name: string, next: () => Promise<any>) {
		// Enqueue the request to happen when the previous request is done.
		const previousPromise = this.promises[name] || Promise.resolve();
		const nextPromise = previousPromise.then(next);

		this.promises[name] = nextPromise;
		return nextPromise;
	}
}
