import { KubernetesMetadata } from '../../types/kubernetes';

/**
 * A queue resource in Kubernetes
 */
export interface KubernetesQueue {
	metadata: KubernetesMetadata;
	spec: QueueSpec;
}

/**
 * A queue specification
 */
interface QueueSpec {
	redrivePolicy?: unknown;
	policy?: unknown;
	[key: string]: any;
}
