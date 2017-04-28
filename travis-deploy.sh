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
done
