# Tor client for the investigation toolkit. Tor itself comes from the Tor Project's own
# Debian repository (signing key pinned by fingerprint); the base image is pinned by digest.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
ARG TOR_KEY_FPR=A3C4F0F979CAA22CDBA8F512EE8CBC9E886DDD89
RUN set -eux; apt-get update; apt-get install -y --no-install-recommends ca-certificates curl gpg; \
    curl -fsSL https://deb.torproject.org/torproject.org/${TOR_KEY_FPR}.asc -o /tmp/tor.asc; \
    gpg --show-keys --with-colons /tmp/tor.asc | grep -q "^fpr:::::::::${TOR_KEY_FPR}:"; \
    gpg --dearmor < /tmp/tor.asc > /usr/share/keyrings/deb.torproject.org-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/deb.torproject.org-keyring.gpg] https://deb.torproject.org/torproject.org bookworm main" > /etc/apt/sources.list.d/tor.list; \
    apt-get update; apt-get install -y --no-install-recommends tor deb.torproject.org-keyring; \
    apt-get purge -y curl gpg; apt-get autoremove -y; rm -rf /var/lib/apt/lists/* /tmp/tor.asc
COPY toolkit/docker/torrc /etc/tor/torrc
USER debian-tor
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=60 \
  CMD grep -q "Bootstrapped 100%" /var/lib/tor/notices.log
ENTRYPOINT ["tor", "-f", "/etc/tor/torrc"]
