.PHONY: help test build release run_dev_backend run_dev_frontend

define HELPTEXT
Makefile usage
 Targets:
    run_dev_backend   Run development instance of the backend.
    run_dev_frontend  Run development instance of the frontend.
    build             Build docker images for backend/frontend.
    publish           Publish docker images for backend/frontend.
endef
export HELPTEXT

help:
	@echo "$$HELPTEXT"

run_dev_backend:
	$(MAKE) -C backend run_dev

run_dev_frontend:
	$(MAKE) -C frontend run_dev

build:
	$(MAKE) -C backend docker_build
	$(MAKE) -C frontend docker_build

publish:
	$(MAKE) -C backend publish_ebrains
	$(MAKE) -C frontend publish_ebrains
