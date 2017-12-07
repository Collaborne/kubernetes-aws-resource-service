const AWS = require('aws-sdk');

const _ = require('lodash');

const {capitalize, capitalizeFieldNames, delay, isTransientNetworkError, md5} = require('./utils');

/**
 * A IAM Role
 *
 * @typedef Role
 * @property {KubernetesMetadata} metadata
 * @property {RoleSpec} spec
 * @property {RoleStatus} status
 */

/**
 * Kubernetes resource metadata
 *
 * @typedef KubernetesMetadata
 * @property {String} namespace
 * @property {String} name
 * @property {Object.<String,String>} labels
 * @property {Object.<String,String>} metadata
 */

/**
 * A IAM role specification
 *
 * @typedef RoleSpec
 * @property {string} description
 * @property {string} path
 * @property {Policy[]} policies
 */

/**
 * A IAM role status
 *
 * @typedef RoleStatus
 */

/**
 * A IAM Role Policy
 *
 * @typedef Policy
 * @property TODO
 */

const logger = require('log4js').getLogger('IAMRole');
class IAMRole { // eslint-disable-line padded-blocks
	/**
	 *
	 * @param {Object} [options] IAM client options
	 */
	constructor(options = {}) {
		this.iam = new AWS.IAM(Object.assign({}, options));
	}

	/**
	 * @typedef TranslateAttributesResult
	 * @property {Object} attributes
	 * @property {Policy[]} policies
	 */

	/**
	 * Convert the resource.spec parts from camelCase to AWS CapitalCase.
	 *
	 * @param {Object} resource a resource definition
	 * @return {TranslateAttributesResult} the queue attributes
	 */
	_translateAttributes(resource) {
		const policies = [];
		const attributes = Object.keys(resource.spec || {}).reduce((result, key) => {
			const value = resource.spec[key];

			let resultValue;
			switch (key) {
			case 'policies':
				value.map(capitalizeFieldNames).forEach(policy => policies.push(policy));
				// Don't process this further: 'policies' does not actually belong into an IAM::Role.
				return result;
			case 'assumeRolePolicyDocument':
				// Apply the default version if it is missing. This simplifies later comparisions of these values.
				// See http://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_version.html
				resultValue = JSON.stringify(Object.assign({Version: '2008-10-17'}, capitalizeFieldNames(value)));
				break;
			default:
				// Convert to string
				resultValue = `${value}`;
				break;
			}
			logger.debug(`[${resource.metadata.name}]: Attribute ${key} = ${resultValue}`);

			result[capitalize(key)] = resultValue;
			return result;
		}, {});

		return {
			attributes,
			policies,
		};
	}

	_getRolePolicyName(roleName, policy) {
		return `${roleName}-${md5(JSON.stringify(policy))}`;
	}

	// XXX: logName could be awsOperation.name, except that that is empty for AWS?
	_retryOnTransientNetworkErrors(logName, awsOperation, awsArguments) {
		const errorRetryDelay = 30000;
		return awsOperation.apply(this.iam, awsArguments).promise()
			.catch(err => {
				if (isTransientNetworkError(err)) {
					logger.warn(`[${logName}]: transient ${err.code} ${err.errno}, retrying in ${errorRetryDelay / 1000}s`);
					return delay(errorRetryDelay).then(() => this._retryOnTransientNetworkErrors(logName, awsOperation, awsArguments));
				}

				logger.warn(`[${logName}]: non-retryable error in operation: ${err.message}`);
				throw err;
			});
	}

	_reportRoleError(roleName, err, description) {
		logger.warn(`[${roleName}]: ${description}: ${err.message}`);
		throw new Error(`${description}: ${err.message}`);
	}

	_getRole(roleName) {
		const request = {
			RoleName: roleName
		};
		return this._retryOnTransientNetworkErrors('IAM::GetRole', this.iam.getRole, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot get role'));
	}

	_createRole(roleName, attributes) {
		const request = Object.assign({}, attributes, {RoleName: roleName});
		return this._retryOnTransientNetworkErrors('IAM::CreateRole', this.iam.createRole, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot create role'));
	}

	_deleteRole(roleName) {
		const request = {
			RoleName: roleName
		};
		return this._retryOnTransientNetworkErrors('IAM::DeleteRole', this.iam.deleteRole, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot delete role'));
	}

	_listRolePolicies(roleName) {
		const request = {
			RoleName: roleName
		};
		return this._retryOnTransientNetworkErrors('IAM::ListRolePolicies', this.iam.listRolePolicies, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot list role policies'));
	}

	_putRolePolicy(roleName, policy) {
		const policyName = this._getRolePolicyName(roleName, policy);
		const request = {
			PolicyDocument: JSON.stringify(policy),
			PolicyName: policyName,
			RoleName: roleName,
		};
		// Log each added policy and the content
		logger.info(`[${roleName}]: Adding policy ${policyName} '${JSON.stringify(policy)}'`);
		return this._retryOnTransientNetworkErrors('IAM::PutRolePolicy', this.iam.putRolePolicy, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot put role policy'));
	}

	_deleteRolePolicy(roleName, policyName) {
		const request = {
			PolicyName: policyName,
			RoleName: roleName,
		};
		// Log each removed policy
		// XXX: Should we actually query the content before doing that?
		logger.info(`[${roleName}]: Removing policy ${policyName}`);
		return this._retryOnTransientNetworkErrors('IAM::DeleteRolePolicy', this.iam.deleteRolePolicy, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot delete role policy'));
	}

	_updateRoleDescription(roleName, description) {
		const request = {
			Description: description,
			RoleName: roleName
		};
		return this._retryOnTransientNetworkErrors('IAM::UpdateRoleDescription', this.iam.updateRoleDescription, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot update role description'));
	}

	_updateAssumeRolePolicy(roleName, policy) {
		const request = {
			PolicyDocument: JSON.stringify(policy),
			RoleName: roleName,
		};
		return this._retryOnTransientNetworkErrors('IAM::UpdateAssumeRolePolicy', this.iam.updateAssumeRolePolicy, [request])
			.catch(err => this._reportRoleError(roleName, err, 'Cannot update assume role policy'));
	}

	/**
	 * Create a new Role
	 *
	 * @param {Role} role Role definition in Kubernetes
	 * @returns {Promise<any>} a promise that resolves when the role was created
	 */
	create(role) {
		const {attributes, policies} = this._translateAttributes(role);
		return this._createRole(role.metadata.name, attributes)
			.then(response => {
				const roleName = response.Role.RoleName;
				const putRolePolicyPromises = policies.map(policy => {
					return this._putRolePolicy(roleName, policy);
				});

				return Promise.all(putRolePolicyPromises);
			});
	}

	/**
	 * Updates a Role
	 *
	 * @param {Role} role Role definition in Kubernetes
	 * @returns {Promise<any>} a promise that resolves when the role was updated
	 */
	update(role) {
		const roleName = role.metadata.name;
		const {attributes, policies} = this._translateAttributes(role);
		return this._getRole(roleName)
			.catch(err => {
				// If not there: create it.
				if (err.name === 'NoSuchEntity') {
					logger.info(`[${roleName}]: Role does not/no longer exist, re-creating it`);
					return this.create(role);
				}

				throw new Error(`Cannot update role ${roleName}: ${err.message}`);
			})
			.then(response => {
				// First check the path: It cannot be changed, so we will not allow any update to it.
				// The default value is a '/' (see https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicy.html), so we need to check that
				// explicitly.
				if (response.Role.Path !== (attributes.Path || '/')) {
					throw new Error(`Cannot update role ${roleName}: 'path' cannot be modified`);
				}

				// Find all role policies, and synchronize them: remove the ones that are no longer valid, then add new ones.
				// Note that the 'Description' of a policy is immutable, but in our case we're including the hash of the description in the name, so when it changes
				// we just replace the respective policy.
				// XXX: This replacing could lead to races where the role temporarily doesn't provide all needed permissions. The user must take that into account when designing their update flows.
				return this._listRolePolicies(roleName)
					.then(rolePoliciesResponse => {
						const expectedPoliciesByName = policies.map(policy => ({
							name: this._getRolePolicyName(roleName, policy),
							policy
						})).reduce((result, value) => Object.assign(result, {[value.name]: value.policy}), {});
						const existingRolePolicyNames = rolePoliciesResponse.PolicyNames;
						const expectedPolicyNames = Object.keys(expectedPoliciesByName);
						const removePoliciesPromises = _.difference(existingRolePolicyNames, expectedPolicyNames).map(policyName => this._deleteRolePolicy(roleName, policyName));
						const addPoliciesPromises = _.difference(expectedPolicyNames, existingRolePolicyNames).map(policyName => expectedPoliciesByName[policyName]).map(policy => this._putRolePolicy(roleName, policy));

						const updatePromises = [
							...removePoliciesPromises,
							...addPoliciesPromises,
						];
						if (response.Role.Description !== attributes.Description) {
							logger.debug(`[${roleName}]: Updating description`);
							updatePromises.push(this._updateRoleDescription(roleName, attributes.Description));
						}

						const existingAssumeRolePolicy = JSON.parse(decodeURIComponent(response.Role.AssumeRolePolicyDocument));
						const expectedAssumeRolePolicy = JSON.parse(attributes.AssumeRolePolicyDocument);
						if (!_.isEqual(existingAssumeRolePolicy, expectedAssumeRolePolicy)) {
							logger.debug(`[${roleName}]: Updating assume role policy`);
							updatePromises.push(this._updateAssumeRolePolicy(roleName, expectedAssumeRolePolicy));
						}

						return Promise.all(updatePromises);
					});
			});
	}

	/**
	 * Delete IAM role
	 *
	 * @param {Role} role Role definition in Kubernetes
	 * @return {Promise<any>} a promise that resolves when the role was deleted
	 */
	delete(role) {
		const roleName = role.metadata.name;
		return this._listRolePolicies(roleName)
			.then(response => Promise.all(response.PolicyNames.map(policyName => this._deleteRolePolicy(roleName, policyName))))
			.then(() => this._deleteRole(roleName));
	}
}

module.exports = IAMRole;
