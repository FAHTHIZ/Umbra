# Umbra Assistant (planned, local-only)

Any assistant must run **entirely on-device**, with no cloud API calls, because those would leak page content and queries. Candidate: Firefox's local inference engine (ML models, ONNX in a sandboxed process), if it's present in the ESR base, used for page summarisation and translation (Firefox Translations already works locally). Model downloads would go over Tor from a pinned, hashed source. Status: research. It's blocked on checking what the ESR 153 base ships and on memory budget measurements.
