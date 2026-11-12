import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../../overlay/privacy/privacy-checks.mjs";

const SAFE = {
  torStage: "Bootstrapped", torEnabled: true, securityLevel: "standard", securityCustom: false, search: "OnionSearch",
  prefs: {
    "network.proxy.type": 1, "network.proxy.socks": "127.0.0.1", "network.proxy.socks_port": 9150,
    "network.proxy.socks_remote_dns": true, "privacy.resistFingerprinting": true,
    "privacy.resistFingerprinting.letterboxing": true, "media.peerconnection.enabled": false,
    "dom.security.https_only_mode": true, "browser.privatebrowsing.autoStart": true,
    "browser.search.suggest.enabled": false, "umbra.access.enabled": false,
    "umbra.version": "0.1.0", "umbra.upstream.torbrowser": "16.0.1",
  },
};
const rows = r => r.groups.flatMap(g => g.rows);
const row = (r, label) => rows(r).find(x => x.label === label);
const withPrefs = over => ({ ...SAFE, prefs: { ...SAFE.prefs, ...over } });

test("default Umbra configuration is fully protected", () => {
  const r = evaluate(SAFE);
  assert.equal(r.overall.status, "ok");
  assert.equal(r.version, "Umbra 0.1.0 · based on Tor Browser 16.0.1");
  assert.ok(rows(r).every(x => x.status === "ok" || x.status === "info"));
});

test("disabling fingerprinting protection is flagged as weakened", () => {
  const r = evaluate(withPrefs({ "privacy.resistFingerprinting": false }));
  assert.equal(row(r, "Fingerprinting protection").status, "bad");
  assert.equal(r.overall.status, "bad");
});

test("local DNS or a non-SOCKS proxy is flagged", () => {
  assert.equal(row(evaluate(withPrefs({ "network.proxy.socks_remote_dns": false })), "All traffic through Tor").status, "bad");
  assert.equal(row(evaluate(withPrefs({ "network.proxy.type": 0 })), "All traffic through Tor").status, "bad");
});

test("WebRTC and non-Tor proxy mode are flagged", () => {
  assert.equal(row(evaluate(withPrefs({ "media.peerconnection.enabled": true })), "WebRTC").status, "bad");
  assert.equal(row(evaluate(withPrefs({ "extensions.torbutton.use_nontor_proxy": true })), "Per-site circuits").status, "bad");
});

test("custom security level asks for review", () => {
  const r = evaluate({ ...SAFE, securityCustom: true });
  assert.equal(row(r, "Security level").status, "warn");
  assert.equal(r.overall.status, "warn");
});

test("not connected is a warning, never 'protected'", () => {
  const r = evaluate({ ...SAFE, torStage: "Start" });
  assert.equal(row(r, "Tor connection").status, "warn");
  assert.notEqual(r.overall.status, "ok");
});

test("search provider text never claims the provider provides anonymity", () => {
  for (const search of ["OnionSearch", "Google"]) {
    const d = row(evaluate({ ...SAFE, search }), "Search provider").detail;
    assert.match(d, /sees your search terms/);
    assert.match(d, /separate things/);
  }
});

test("Access Engine filtering on is informational, with fingerprint caveat", () => {
  const r = row(evaluate(withPrefs({ "umbra.access.enabled": true })), "Access Engine filtering");
  assert.equal(r.status, "info");
  assert.match(r.detail, /tell you apart/);
});
