"""Anti-fingerprinting parity: Umbra must expose the same security/privacy
preference state as the unmodified upstream Tor Browser it is built from."""
from tests.browser_driver import chrome_eval, start, stop
from tests.unit.test_prefs_policy import DENY_PREFIXES

DUMP = """
const out = {};
for (const n of Services.prefs.getChildList('')) {
  const t = Services.prefs.getPrefType(n);
  try {
    out[n] = t == 32 ? Services.prefs.getStringPref(n) : t == 64 ? Services.prefs.getIntPref(n) : t == 128 ? Services.prefs.getBoolPref(n) : null;
  } catch (e) {}
}
return out;"""

# Prefs that legitimately differ per run/profile (timestamps, ids, ports).
VOLATILE = ("marionette.", "remote.", "network.http.speculative-parallel-limit", "dom.disable_open_during_load",
            "browser.cache.disk.parent_directory", "privacy.sanitize.pending", "network.cookie.prefsMigrated",
            "dom.forms.autocomplete.formautofill", "security.sandbox.content.tempDirSuffix",
            "security.sandbox.plugin.tempDirSuffix", "toolkit.startup.last_success", "dom.push.userAgentID",
            "network.connectivity-service.", "network.trr.", "browser.cache.disk.smart_size", "media.gmp-manager.",
            "privacy.purge_trackers.date_in_cookie_database", "network.predictor.cleaned-up",
            "network.dns.disablePrefetch", "dom.serviceWorkers.enabled", "dom.ipc.processCount",
            "security.remote_settings.", "media.gmp.storage.version.observed", "dom.input_events.security",
            "general.useragent.", "dom.webnotifications", "security.ssl.enable_ocsp_stapling", "extensions.webextensions.uuids")


def _dump(app):
    d = start(app)
    try:
        return chrome_eval(d, DUMP)
    finally:
        stop(d)


def test_security_prefs_identical_to_upstream(umbra_app, upstream_app):
    u, t = _dump(umbra_app), _dump(upstream_app)
    keys = {k for k in set(u) | set(t) if k.startswith(DENY_PREFIXES) and not k.startswith(VOLATILE)}
    diff = {k: (t.get(k), u.get(k)) for k in sorted(keys) if u.get(k) != t.get(k)}
    assert len(keys) > 500, "suspiciously few security prefs compared"
    assert not diff, f"Umbra differs from upstream on {len(diff)} sensitive prefs: {list(diff.items())[:20]}"
