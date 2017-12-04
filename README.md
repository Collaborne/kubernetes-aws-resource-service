# kubernetes-aws-resource-service [![Build Status](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service.svg?branch=master)](https://travis-ci.org/Collaborne/kubernetes-aws-resource-service)

An "operator" service to automatically manage AWS resources based on kubernetes TPRs.

## Supported Resources

[resources.yml](/resources.yml) has the definitions of all supported resources.

* SQS queues
  ```yaml
  kind: Queue
  metadata:
    name: my-queue
  spec:
    anyAwsSqsQueueAttribute: value
  ```
  
  All attributes are converted into strings, embedded `redrivePolicy` and `policy` attributes using `JSON.stringify()`.
* Others? [PRs welcome :D](https://github.com/Collaborne/kubernetes-aws-resource-service/compare)
  

