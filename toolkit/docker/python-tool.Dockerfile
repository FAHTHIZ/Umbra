# Generic image for a Python investigation tool, built from an exact upstream commit.
FROM python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ARG REPO
ARG COMMIT
ARG INSTALL="pip install --no-cache-dir ."
RUN apt-get update && apt-get install -y --no-install-recommends git socat ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN git init -q /src && cd /src && git remote add origin "$REPO" && git fetch -q --depth 1 origin "$COMMIT" \
    && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$COMMIT" && rm -rf .git
WORKDIR /src
RUN sh -c "$INSTALL"
COPY toolkit/docker/forward.sh /usr/local/bin/umbra-forward
RUN useradd -m -u 10001 tool && mkdir -p /out && chown tool /out
USER tool
WORKDIR /out
ENTRYPOINT ["umbra-forward"]
