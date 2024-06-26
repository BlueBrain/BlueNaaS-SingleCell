.PHONY: help run_dev js_build docker_build run_docker

VERSION?=$(shell cat ../VERSION)
NEURON_VERSION?=$(shell cat ../NEURON_VERSION)
IMAGE_NAME?=blue-naas
TAG?=ebrains2-dev
REGISTRY?=docker-registry.ebrains.eu/bsp-epfl

define HELPTEXT
Makefile usage
 Targets:
    js_build     Create dist/ folder for production Web UI.
    run_dev      Run development version web server with BlueNaaS Web UI.
    docker_build Build dev frontend docker image.
endef
export HELPTEXT

help:
	@echo "$$HELPTEXT"

node_modules:
	npm install

run_dev: | node_modules
	VERSION=$(VERSION) NEURON_VERSION=$(NEURON_VERSION) WS_URL=ws://localhost:8000 npm start

run_dev_docker: docker_build
	docker run --rm -it \
		-p 8080:8000 \
		$(IMAGE_NAME):$(TAG)

js_build: | node_modules
	npm run build

docker_build:
	docker build -t $(IMAGE_NAME):$(TAG) \
		--build-arg WS_URL=wss://bluenaas-single-cell-svc.apps.tc.humanbrainproject.eu \
		--build-arg VERSION=$(VERSION) \
		--build-arg NEURON_VERSION=$(NEURON_VERSION) \
		.

run_docker: docker_build
	docker run --rm -it \
		-p 8080:8000 \
		$(IMAGE_NAME):$(TAG)

publish_ebrains: docker_build
	docker tag $(IMAGE_NAME):$(TAG) $(REGISTRY)/$(IMAGE_NAME):$(TAG)
	docker push $(REGISTRY)/$(IMAGE_NAME):$(TAG)
