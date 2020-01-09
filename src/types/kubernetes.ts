import { Effect } from './aws';

/**
 * Kubernetes resource metadata
 */
export interface KubernetesMetadata {
	namespace?: string;
	name: string;
	labels?: {[key: string]: string};
	metadata?: {[key: string]: string};
}

export interface KubernetesStatement {
	sid?: string;
	effect: Effect;
	action: string | string[];
	principal?: string|object;
	resource?: string|string[];
	[key: string]: any;
}

export interface KubernetesPolicy {
	id?: string;
	version?: '2012-10-17';
	statement: KubernetesStatement[];
}

export interface KubernetesTag {
	key: string;
	value: string;
}
