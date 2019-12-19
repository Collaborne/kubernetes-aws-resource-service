export interface ResourceClient<T> {
	create(resource: T): Promise<any>;
	update(resource: T): Promise<any>;
	delete(resource: T): Promise<any>;
}
