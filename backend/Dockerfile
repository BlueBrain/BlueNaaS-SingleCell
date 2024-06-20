FROM python:3.12-slim AS builder
WORKDIR /app
ARG VERSION
COPY . .
RUN python setup.py sdist

FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

ARG VERSION
ARG NEURON_VERSION

RUN apt-get update \
  && apt-get install -q -y --no-install-recommends build-essential \
  && pip install --no-cache-dir --upgrade setuptools pip \
  && pip install --no-cache-dir neuron==${NEURON_VERSION}

WORKDIR /opt/blue-naas

COPY --from=builder /app/dist/blue-naas-${VERSION}.tar.gz ./
RUN pip install --no-cache-dir blue-naas-${VERSION}.tar.gz

ADD entrypoint.sh entrypoint.sh
RUN mkdir probes && chmod a+rw probes \
    && mkdir tmp && chmod a+rw tmp \
    && mkdir x86_64 && chmod a+rw x86_64

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
