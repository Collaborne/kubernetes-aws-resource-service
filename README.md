# kubernetes-aws-resource-service [![Build Status](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service.svg?branch=master)](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service) [![Greenkeeper badge](https://badges.greenkeeper.io/Collaborne/kubernetes-aws-resource-service.svg)](https://greenkeeper.io/)

An "operator" service to automatically manage AWS resources based on kubernetes CRDs.

## Supported Resources

[resources.yml](/resources.yml) has the definitions of all currently supported resources. This file should be loaded into the cluster before using the kubernetes-aws-resource-service to create the CustomResourceDefinitions.

```sh
kubectl apply -f resources.yml
```

### General Notes

1. The resource specification parts follow the AWS SDK naming, but use smallCamelCapitalization to better fit with the naming of properties in Kubernetes
2. When the the AWS SDK uses JSON-as-String for attributes these JSON elements are automatically created from the resource description

See below for notes on specific resource types.

### S3 buckets

| Property | AWS SDK property | Notes
|----------|------------------|------
| `acl`    | `ACL`            | Uses all-lowercase name instead of all-caps

See here the [description of the AWS fields](http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html).

_Currently only create and delete is supported, attempts to update a bucket are ignored and logged as an error._

#### Example

```yaml
kind: Bucket
metadata:
  name: TestBucket
spec:
  spec:
    acl: 'private'
    createBucketConfiguration:
      locationConstraint: 'EU'
```

### SQS queues

| Property        | AWS SDK property | Notes
|-----------------|------------------|------
| `policy`        | `Policy`         | Should be written directly in the YAML, and will get encoded into JSON. The `Resource` field in the policy will be automatically set to the ARN of the queue
| `redrivePolicy` | `RedrivePolicy`  | Should be written directly in the YAML, and will get encoded into JSON.

#### Example

```yaml
kind: Queue
metadata:
  name: my-queue
spec:
  policy:
    version: "2012-10-17"
    statement:
    - effect: Allow
      action: "sqs:*"
```

### IAM Roles

| Property     | AWS SDK property | Notes
|--------------|------------------|------
| `policies`   | (No equivalent)  | The `policies` element contains an array of AWS IAM Policy definitions that are directly added to the role. The name of the policy is generated from the content, and updating works by comparing these names. **Note that automatic capitalization is not applied to the contents of the `Condition` of a policy.**
| `policyArns` | (No equivalent)  | The `policyArns` element contains an array of AWS IAM policy ARNs, which are attached to the role.

#### Example

```yaml
kind: Role
metadata:
  name: my-role
spec:
  path: /role-path/
  assumeRolePolicyDocument:
    version: 2012-10-17
    statement:
    - action: sts:AssumeRole
      effect: Allow
      principal:
        service: ec2.amazonaws.com
  policies:
  - version: 2012-10-17
    statement:
    - action:
      - 'ec2:*'
      effect: Allow
      resource:
      - '*'
  policyArns:
  - arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

## Development Notes & Caveats

* Tests for S3Client may fail when another test has loaded the AWS SDK, in particular the S3 prototype. The tests should still run properly as part of `npm test`.
