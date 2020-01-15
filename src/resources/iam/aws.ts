import { IAM } from 'aws-sdk';
import { Tag } from 'aws-sdk/clients/iam';
import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';

import { retryOnTransientNetworkErrors } from '../utils';

const logger = getLogger('iam/aws');

/**
 * Client to connect to AWS IAM
 */
export class IAMClient {
	private iam: IAM;

	constructor(options: IAM.Types.ClientConfiguration = {}) {
		this.iam = new IAM(options);
	}

	public async getRole(roleName: string) {
		const request = {
			RoleName: roleName,
		};
		const response = await retryOnTransientNetworkErrors(`${roleName} - IAM::GetRole`, () => this.iam.getRole(request));
		return response.Role;
	}

	public createRole(roleName: string, attributes: any) {
		const request = {
			...attributes,
			RoleName: roleName,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::CreateRole`, () => this.iam.createRole(request));
	}

	public deleteRole(roleName: string) {
		const request = {
			RoleName: roleName,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::DeleteRole`, () => this.iam.deleteRole(request));
	}

	public tagRole(roleName: string, tags: Tag[]) {
		const request = {
			RoleName: roleName,
			Tags: tags,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::TagRole`, () => this.iam.tagRole(request));
	}

	public untagRole(roleName: string, tagKeys: string[]) {
		const request = {
			RoleName: roleName,
			TagKeys: tagKeys,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::UntagRole`, () => this.iam.untagRole(request));
	}

	public listRoleTags(roleName: string) {
		const request = {
			RoleName: roleName,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::ListRoleTags`, () => this.iam.listRoleTags(request));
	}

	/**
	 * Helper function to update the tags of a role to the given list of tags.
	 *
	 * This helper will remove and add tags so that the tags of the role in AWS matches the provided
	 * list of tags.
	 */
	public async updateRoleTags(roleName: string, tags: Tag[]) {
		const {Tags: existingTags, IsTruncated: isTruncated} = await this.listRoleTags(roleName);
		if (isTruncated) {
			throw new Error(`Role ${roleName} has too many tags, pagination is not implemented`);
		}

		const tagKeysToRemove = existingTags.map(tag => tag.Key).filter(tagKey => {
			return !tags.find(t => t.Key === tagKey);
		});
		if (tagKeysToRemove.length > 0) {
			logger.debug(`[${roleName}]: Removing tags with keys ${tagKeysToRemove}`);
			await this.untagRole(roleName, tagKeysToRemove);
		}

		const tagsToAdd = tags.filter(tag => {
			const existingTag = existingTags.find(t => t.Key === tag.Key);
			if (existingTag) {
				return existingTag.Value !== tag.Value;
			}
			return true;
		});
		if (tagsToAdd.length > 0) {
			logger.debug(`[${roleName}]: Adding tags ${JSON.stringify(tagsToAdd)}`);
			await this.tagRole(roleName, tagsToAdd);
		}
	}

	public async listRolePolicies(roleName: string) {
		const request = {
			RoleName: roleName,
		};
		const response = await retryOnTransientNetworkErrors(`${roleName} - IAM::ListRolePolicies`, () => this.iam.listRolePolicies(request));
		return response.PolicyNames;
	}

	public putRolePolicy(policyName: string, roleName: string, policy: Policy) {
		const request = {
			PolicyDocument: JSON.stringify(policy),
			PolicyName: policyName,
			RoleName: roleName,
		};
		// Log each added policy and the content
		logger.info(`[${roleName}]: Adding policy ${policyName} '${JSON.stringify(policy)}'`);
		return retryOnTransientNetworkErrors(`${roleName} - IAM::PutRolePolicy`, () => this.iam.putRolePolicy(request));
	}

	public deleteRolePolicy(roleName: string, policyName: string) {
		const request = {
			PolicyName: policyName,
			RoleName: roleName,
		};
		// Log each removed policy
		// XXX: Should we actually query the content before doing that?
		logger.info(`[${roleName}]: Removing policy ${policyName}`);
		return retryOnTransientNetworkErrors(`${roleName} - IAM::DeleteRolePolicy`, () => this.iam.deleteRolePolicy(request));
	}

	public async listAttachedRolePolicies(roleName: string) {
		const request = {
			RoleName: roleName,
		};
		const response = await retryOnTransientNetworkErrors(`${roleName} - IAM::ListAttachedRolePolicies`, () => this.iam.listAttachedRolePolicies(request));
		return response.AttachedPolicies;
	}

	public attachRolePolicy(roleName: string, policyArn: string) {
		const request = {
			PolicyArn: policyArn,
			RoleName: roleName,
		};
		// Log each added policy and the content
		logger.info(`[${roleName}]: Attaching policy ${policyArn}`);
		return retryOnTransientNetworkErrors(`${roleName} - IAM::AttachRolePolicy`, () => this.iam.attachRolePolicy(request));
	}

	public detachRolePolicy(roleName: string, policyArn: string) {
		const request = {
			PolicyArn: policyArn,
			RoleName: roleName,
		};
		// Log each added policy and the content
		logger.info(`[${roleName}]: Detaching policy ${policyArn}`);
		return retryOnTransientNetworkErrors(`${roleName} - IAM::DetachRolePolicy`, () => this.iam.detachRolePolicy(request));
	}

	public updateRoleDescription(roleName: string, description: string) {
		const request = {
			Description: description,
			RoleName: roleName,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::UpdateRoleDescription`, () => this.iam.updateRoleDescription(request));
	}

	public updateAssumeRolePolicy(roleName: string, policy: Policy) {
		const request = {
			PolicyDocument: JSON.stringify(policy),
			RoleName: roleName,
		};
		return retryOnTransientNetworkErrors(`${roleName} - IAM::UpdateAssumeRolePolicy`, () => this.iam.updateAssumeRolePolicy(request));
	}
}
