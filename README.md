# kubernetes-aws-resource-service [![Build Status](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service.svg?branch=master)](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service)

An "operator" service to automatically manage AWS resources based on kubernetes TPRs.

## Supported Resources

[resources.yml](/resources.yml) has the definitions of all supported resources.

### S3 buckets

Supported fields:

| AWS field | Field in resource definition |
|--------------|-----------|
| ACL | acl |
| CreateBucketConfiguration.LocationConstraint | createBucketConfiguration.locationConstraint |
| GrantFullControl | grantFullControl |
| GrantRead | grantRead |
| GrantReadACP | grantReadACP |
| GrantWrite | grantWrite |
| GrantWriteACP | grantWriteACP |

See here the [description of the AWS fields](http://docs.aws.amazon.com/AmazonS3/latest/API/RESTBucketPUT.html).

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
      grantFullControl: 'grantFullControl'
      grantRead: 'grantRead'
      grantReadACP: 'grantReadACP'
      grantWrite: 'grantWrite'
      grantWriteACP: 'grantWriteACP'
  ```

### SQS queues

#### Example

  ```yaml
  kind: Queue
  metadata:
    name: my-queue
  spec:
    anyAwsSqsQueueAttribute: value
  ```

### General

All attributes are converted into strings, embedded `redrivePolicy` and `policy` attributes using `JSON.stringify()`.
* S3 buckets: Currently only create and delete is supported (update leads to an error message).
* Others? [PRs welcome :D](https://github.com/Collaborne/kubernetes-aws-resource-service/compare)
  

