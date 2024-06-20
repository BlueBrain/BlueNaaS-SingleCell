.PHONY: help run_dev python_build sort_imports docker_build

VERSION?=$(shell cat ../VERSION)
export VERSION
NEURON_VERSION?=$(shell cat ../NEURON_VERSION)
IMAGE_NAME?=blue-naas-svc

define HELPTEXT
Makefile usage
 Targets:
    python_build    Build python package.
    sort_imports    Sort imports in python modules.
    run_dev         Run development instance of the backend.
    docker_build    Build dev backend docker image.
endef
export HELPTEXT

help:
	@echo "$$HELPTEXT"

venv:
	python -m venv $@
	venv/bin/pip install pycodestyle pydocstyle pylint isort codespell
	venv/bin/pip install -e .

python_build: | venv
	@venv/bin/codespell blue_naas
	@venv/bin/pycodestyle blue_naas
	@venv/bin/pydocstyle blue_naas
	@venv/bin/isort --check-only --line-width 100 blue_naas
	@venv/bin/pylint blue_naas
	@venv/bin/python setup.py sdist

sort_imports: | venv
	@venv/bin/isort --line-width 100 blue_naas

docker_build:
	docker build -t $(IMAGE_NAME):dev \
		--build-arg http_proxy=http://bbpproxy.epfl.ch:80/ \
		--build-arg https_proxy=http://bbpproxy.epfl.ch:80/ \
		--build-arg VERSION=$(VERSION) \
		--build-arg NEURON_VERSION=$(NEURON_VERSION) \
		.

run_dev: docker_build
	docker run --rm -it \
		-e DEBUG=True \
		-e ALLOWED_ORIGIN=http://$$(dnsdomainname -A|xargs):8080 \
		-v $$(pwd)/blue_naas:/usr/local/lib/python3.12/site-packages/blue_naas \
		-v $$(pwd)/models:/opt/blue-naas/models \
		-p 8000:8000 \
		$(IMAGE_NAME):dev
