# Generic image for a Go investigation tool, built from an exact upstream commit.
FROM golang:1.26-bookworm@sha256:dc40a13b61304647ed7e5d581d246b86413dfc29d63c6d018310feb93cd98fc0 AS build
ARG REPO
ARG COMMIT
ARG PKG=./cmd/...
RUN git init -q /src && cd /src && git remote add origin "$REPO" && git fetch -q --depth 1 origin "$COMMIT" \
    && git checkout -q FETCH_HEAD && test "$(git rev-parse HEAD)" = "$COMMIT"
WORKDIR /src
RUN CGO_ENABLED=0 GOBIN=/out go install $PKG

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update && apt-get install -y --no-install-recommends socat ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /usr/local/bin/
COPY toolkit/docker/forward.sh /usr/local/bin/umbra-forward
RUN useradd -m -u 10001 tool && mkdir -p /out && chown tool /out
USER tool
WORKDIR /out
ENTRYPOINT ["umbra-forward"]
