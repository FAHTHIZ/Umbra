#!/bin/sh
# Several upstream tools hard-code 127.0.0.1:9050 / localhost:9050. Instead of patching them,
# forward that local port to the toolkit's Tor container. The container has no other route out.
set -eu
socat TCP-LISTEN:9050,bind=127.0.0.1,fork,reuseaddr TCP:${UMBRA_TOR_ADDR:-172.30.90.2}:9050 &
exec "$@"
