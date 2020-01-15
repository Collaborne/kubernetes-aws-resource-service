import { IAM } from 'aws-sdk';
import * as _ from 'lodash';
import { getLogger } from 'log4js';

import { Policy } from '../../types/aws';

import { ResourceClient } from '../client';
import { md5 } from '../utils';
import { IAMClient } from './aws';
import { KubernetesRole } from './kubernetes-config';
import { translateAttributes } from './kubernetes-to-aws';

const logger = getLogger('IAMRole');

export class IAMRole implements ResourceClient<KubernetesRole> {
	private iamClient: IAMClient;

	constructor(options: IAM.Types.ClientConfiguration = {}) {
		this.iamClient = new IAMClient(options);
	}

	/**
	 * Create a new Role
	 *
	 * @param role Role definition in Kubernetes
	 * @returns a promise that resolves when the role was created
	 */
	public async create(role: KubernetesRole) {
		const {attributes, policies, policyArns, tags} = translateAttributes(role);
		const response = await this.iamClient.createRole(role.metadata.name, attributes);
		const roleName = response.Role.RoleName;
		const putRolePolicyPromises = policies.map(policy => {
			const policyName = this.getRolePolicyName(roleName, policy);
			return this.iamClient.putRolePolicy(policyName, roleName, policy);
		});
		const attachRolePolicyPromises = policyArns.map(policyArn => {
			return this.iamClient.attachRolePolicy(roleName, policyArn);
		});

		const tagRolePromise = this.iamClient.tagRole(roleName, tags);

		return Promise.all([putRolePolicyPromises, attachRolePolicyPromises, tagRolePromise]);
	}

	/**
	 * Updates a Role
	 *
	 * @param role Role definition in Kubernetes
	 * @returns a promise that resolves when the role was updated
	 */
	public async update(role: KubernetesRole) {
		const roleName = role.metadata.name;
		const {attributes, policies, policyArns, tags} = translateAttributes(role);
		try {
			const iamRole = await this.iamClient.getRole(roleName);
			// First check the path: It cannot be changed, so we will not allow any update to it.
			// The default value is a '/' (see https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicy.html),
			// so we need to check that
			// explicitly.
			if (iamRole.Path !== (attributes.Path || '/')) {
				throw new Error(`Cannot update role ${roleName}: 'path' cannot be modified`);
			}

			// Find all role policies, and synchronize them: remove the ones that are no longer valid, then add new ones.
			// Note that the 'Description' of a policy is immutable, but in our case we're including the hash of the
			// description in the name, so when it changes we just replace the respective policy.
			// XXX: This replacing could lead to races where the role temporarily doesn't provide all needed permissions.
			// The user must take that into account when designing their update flows.
			const rolePolicies = await this.iamClient.listRolePolicies(roleName);
			const expectedPoliciesByName = policies
				.map(policy => ({
					name: this.getRolePolicyName(roleName, policy),
					policy,
				})).reduce((result, value) => ({
					...result,
					[value.name]: value.policy,
				}), {} as {[key: string]: Policy});
			const existingRolePolicyNames = rolePolicies;
			const expectedPolicyNames = Object.keys(expectedPoliciesByName);
			const removePolicyNames = _.difference(existingRolePolicyNames, expectedPolicyNames);
			const removePoliciesPromises = removePolicyNames.map(policyName => {
				return this.iamClient.deleteRolePolicy(roleName, policyName);
			});

			const addPolicyNames = _.difference(expectedPolicyNames, existingRolePolicyNames);
			const addPoliciesPromises = addPolicyNames
				.map(policyName => expectedPoliciesByName[policyName])
				.map(policy => {
					const policyName = this.getRolePolicyName(roleName, policy);
					return this.iamClient.putRolePolicy(policyName, roleName, policy);
				});

			// Same for the attached policies.
			const attachedRolePolicies = await this.iamClient.listAttachedRolePolicies(roleName);
			const existingAttachedRolePolicyArns = (attachedRolePolicies || []).map(attachedPolicy => attachedPolicy.PolicyArn!);
			const expectedAttachedRolePolicyArns = policyArns;

			const detachPolicyArns = _.difference(existingAttachedRolePolicyArns, expectedAttachedRolePolicyArns);
			const detachPolicyArnsPromises = detachPolicyArns.map(policyArn => {
				return this.iamClient.detachRolePolicy(roleName, policyArn);
			});

			const attachPolicyArns = _.difference(expectedAttachedRolePolicyArns, existingAttachedRolePolicyArns);
			const attachPolicyArnsPromises = attachPolicyArns.map(policyArn => {
				return this.iamClient.attachRolePolicy(roleName, policyArn);
			});

			await Promise.all([
				...removePoliciesPromises,
				...addPoliciesPromises,
				...detachPolicyArnsPromises,
				...attachPolicyArnsPromises,
			]);
			const updatePromises = [];
			if (iamRole.Description !== attributes.Description) {
				logger.debug(`[${roleName}]: Updating description`);
				updatePromises.push(this.iamClient.updateRoleDescription(roleName, attributes.Description));
			}

			const existingAssumeRolePolicy = JSON.parse(decodeURIComponent(iamRole.AssumeRolePolicyDocument!));
			const expectedAssumeRolePolicy = JSON.parse(attributes.AssumeRolePolicyDocument);
			if (!_.isEqual(existingAssumeRolePolicy, expectedAssumeRolePolicy)) {
				logger.debug(`[${roleName}]: Updating assume role policy`);
				updatePromises.push(this.iamClient.updateAssumeRolePolicy(roleName, expectedAssumeRolePolicy));
			}

			if (tags) {
				await this.iamClient.tagRole(roleName, tags);
			}

			return Promise.all(updatePromises);
		} catch (err) {
			// If not there: create it.
			if (err.name === 'NoSuchEntity') {
				logger.info(`[${roleName}]: Role does not/no longer exist, re-creating it`);
				return this.create(role);
			}

			throw new Error(`Cannot update role ${roleName}: ${err.message}`);
		}
	}

	/**
	 * Delete IAM role
	 *
	 * @param role Role definition in Kubernetes
	 * @return a promise that resolves when the role was deleted
	 */
	public async delete(role: KubernetesRole) {
		const roleName = role.metadata.name;

		const policyNames = await this.iamClient.listRolePolicies(roleName);
		const deleteRolePoliciesPromises = policyNames.map(policyName => {
			return this.iamClient.deleteRolePolicy(roleName, policyName);
		});

		const attachedPolicies = await this.iamClient.listAttachedRolePolicies(roleName);
		const detachRolePolicyPromises = (attachedPolicies || [])
			.map(attachedPolicy => this.iamClient.detachRolePolicy(roleName, attachedPolicy.PolicyArn!));
		await Promise.all([
			...deleteRolePoliciesPromises,
			...detachRolePolicyPromises,
		]);
		this.iamClient.deleteRole(roleName);
	}

	private getRolePolicyName(roleName: string, policy: Policy) {
		return `${roleName}-${md5(JSON.stringify(policy))}`;
	}
}
