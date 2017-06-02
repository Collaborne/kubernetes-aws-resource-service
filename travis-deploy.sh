#!/bin/sh

DOCKER_NAME=$1
if [ -z "${DOCKER_NAME}" ]; then
	echo "Usage: $0 docker-name version-tag [version-tag...]" >&2
	exit 1
fi

shift

if [ $# -eq 0 ]; then
	echo "Usage: $0 docker-name version-tag [version-tag...]" >&2
	exit 1
fi

for v in $*; do
	echo "Pushing: ${DOCKER_NAME}:$v"
	docker push ${DOCKER_NAME}:$v
	if [ $? -ne 0 ]; then
		echo "Cannot push image ${DOCKER_NAME}:$v, aborting"
		exit 1
	fi

	_safeDockerName=`echo ${DOCKER_NAME} | sed 's,/,%2f,g'`
	_branches=`curl -sfX PUT -H "authorization: Bearer ${DEPLOYER_TOKEN}" https://deployer.internal.collaborne.com/api/repositories/${_safeDockerName}/images/$v`
	if [ $? -ne 0 ]; then
		echo "Cannot register image ${DOCKER_NAME}:$v with the deployer, image will not be automatically deployed"
	else
		echo "Triggered build for branches: `echo ${_branches} | jq -r '.branches[]' | xargs echo`"
	fi
done
