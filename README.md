# kubernetes-aws-resource-service [![Build Status](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service.svg?branch=master)](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service)

An "operator" service to automatically manage AWS resources based on kubernetes TPRs.

## Supported Resources

[resources.yml](/resources.yml) has the definitions of all currently supported resources. This file should be loaded into the cluster before using the kubernetes-aws-resource-service to create the ThirdPartyResources.

```sh
kubectl apply -f resources.yml
```

### General Notes

1. The resource specification parts follow the AWS SDK naming, but use smallCamelCapitalization to better fit with the naming of properties in Kubernetes
2. When the the AWS SDK uses JSON-as-String for attributes these JSON elements are automatically created from the resource description

See below for notes on specific resource types.

### S3 buckets

Special properties:

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
| `policies`   | (No equivalent)  | The `policies` element contains an array of AWS IAM Policy definitions that are directly added to the role. The name of the policy is generated from the content, and updating works by comparing these names. **Note that automatic capitalization is not applied to the contents of the `Condition` of a policy.
| `policyArns` | (No equivalent)  | The `policyArns` element contains an array of AWS IAM policy ARNs, which are attached to the role.