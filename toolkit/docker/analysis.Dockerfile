# Offline analysis: exiftool and hashdeep built from their pinned commits, mitmproxy at the
# pinned release, and Umbra's case tools. Runs with network_mode: none.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ARG EXIFTOOL_COMMIT
ARG HASHDEEP_COMMIT
ARG MITMPROXY_VERSION=12.3.1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates build-essential autoconf automake \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    git init -q /opt/exiftool; cd /opt/exiftool; git remote add origin https://github.com/exiftool/exiftool.git; \
    git fetch -q --depth 1 origin "$EXIFTOOL_COMMIT"; git checkout -q FETCH_HEAD; test "$(git rev-parse HEAD)" = "$EXIFTOOL_COMMIT"; \
    rm -rf .git; ln -s /opt/exiftool/exiftool /usr/local/bin/exiftool; exiftool -ver
RUN set -eux; \
    git init -q /tmp/hashdeep; cd /tmp/hashdeep; git remote add origin https://github.com/jessek/hashdeep.git; \
    git fetch -q --depth 1 origin "$HASHDEEP_COMMIT"; git checkout -q FETCH_HEAD; test "$(git rev-parse HEAD)" = "$HASHDEEP_COMMIT"; \
    sh bootstrap.sh; ./configure --quiet; make -j"$(nproc)" -s; make install -s; cd /; rm -rf /tmp/hashdeep; hashdeep -V
RUN pip install --no-cache-dir "mitmproxy==${MITMPROXY_VERSION}" "cryptography>=42"
COPY tools/__init__.py /opt/umbra/tools/__init__.py
COPY tools/investigate /opt/umbra/tools/investigate
ENV PYTHONPATH=/opt/umbra
RUN useradd -m -u 10001 analyst
USER analyst
WORKDIR /cases
ENTRYPOINT ["python3", "-m"]
CMD ["tools.investigate.verify_case", "--help"]
