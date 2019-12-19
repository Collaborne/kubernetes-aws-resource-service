import { KubernetesMetadata, KubernetesPolicy } from '../../types/kubernetes';

/**
 * A IAM Role in Kubernetes
 */
export interface KubernetesRole {
	metadata: KubernetesMetadata;
	spec: RoleSpec;
}

/**
 * A IAM role specification
 */
interface RoleSpec {
	description?: string;
	path?: string;
	policies: KubernetesPolicy[];
	/**
	 * Arns ARNs of attached policies
	 */
	policyArns?: string[];
	[key: string]: any;
}
