import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../../overlay/investigate/investigate-core.mjs";

const ONION = "a".repeat(56) + ".onion";
const DDG = "duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion";

test("onion-only guard: onion allowed, everything that leaves Tor blocked", () => {
  const allow = [`http://${ONION}/`, `https://${DDG}/html?q=x`, `ws://${ONION}/s`, `wss://www.${ONION}:8443/`,
    `http://${ONION.toUpperCase()}/`, `http://${ONION}./`, "about:blank", "chrome://browser/content/x.html",
    "data:text/html,hi", "blob:http://x/1", "moz-extension://abc/x", "file:///tmp/a.html"];
  for (const u of allow) assert.equal(C.guardDecision(u).allow, true, u);
  const block = {
    "https://example.com/": "clearnet-blocked",
    [`https://${ONION}.example.com/`]: "clearnet-blocked",
    "http://expyuzz4wqqyqhjn.onion/": "onion-v2-blocked",
    "http://127.0.0.1:9050/": "localhost-blocked",
    "http://localhost/": "localhost-blocked",
    "http://[::1]/": "localhost-blocked",
    "http://93.184.216.34/": "ip-literal-blocked",
    "http://[2606:2800:220:1::]/": "ip-literal-blocked",
    "ftp://example.com/": "scheme-blocked",
    "gopher://x/": "scheme-blocked",
    "not a url": "invalid-url",
    [`http://${"1".repeat(56)}.onion/`]: "onion-v2-blocked",
  };
  for (const [u, why] of Object.entries(block)) {
    const d = C.guardDecision(u);
    assert.equal(d.allow, false, u);
    assert.equal(d.reason, why, u);
    assert.ok(C.explain(d.reason).length > 10);
  }
});

test("headers: secrets redacted, names kept", () => {
  const h = C.redactHeaders([{ name: "Cookie", value: "sid=abc" }, { name: "Authorization", value: "Basic x" },
    { name: "Accept", value: "text/html" }]);
  assert.equal(h[0].name, "Cookie");
  assert.match(h[0].value, /^\[redacted by Umbra: 7 bytes\]$/);
  assert.doesNotMatch(JSON.stringify(h), /sid=abc|Basic x/);
  assert.equal(h[2].value, "text/html");
});

test("HAR 1.2 structure, blocked entries, redirects", () => {
  const har = C.toHar([
    { started: "2026-11-12T00:00:00.000Z", method: "GET", url: `http://${ONION}/a?q=1`, status: 302, statusText: "Found",
      requestHeaders: [{ name: "Host", value: ONION }], responseHeaders: [{ name: "Location", value: "https://example.com/" }], time: 12 },
    { started: "2026-11-12T00:00:01.000Z", method: "GET", url: "https://example.com/", blocked: "clearnet-blocked" },
  ], { creatorVersion: "0.1.0" });
  assert.equal(har.log.version, "1.2");
  assert.equal(har.log.entries.length, 2);
  const [a, b] = har.log.entries;
  assert.deepEqual(a.request.queryString, [{ name: "q", value: "1" }]);
  assert.equal(a.response.redirectURL, "https://example.com/");
  assert.equal(b.response.status, 0);
  assert.equal(b._umbraBlocked, "clearnet-blocked");
  for (const e of har.log.entries) {
    for (const k of ["startedDateTime", "time", "request", "response", "cache", "timings"]) assert.ok(k in e, k);
  }
});

test("canonical JSON is key-order independent", () => {
  assert.equal(C.canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
});

test("sha256 matches known vector", async () => {
  assert.equal(await C.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("hash chain: verifies, detects tampering, reordering and deletion", async () => {
  const log = [];
  log.push(await C.chainEntry(null, "case-created", { name: "t" }, "2026-11-12T00:00:00.000Z"));
  log.push(await C.chainEntry(log[0], "artifact", { kind: "dom", path: "0001-dom.html", sha256: "ab", url: `http://${ONION}/` }, "2026-11-12T00:00:01.000Z"));
  log.push(await C.chainEntry(log[1], "note", { text: "x" }, "2026-11-12T00:00:02.000Z"));
  assert.equal(log[0].prev, C.GENESIS);
  assert.deepEqual(await C.verifyChain(log), { ok: true, count: 3, brokenAt: null, problem: null });
  const tampered = structuredClone(log);
  tampered[1].data.sha256 = "cd";
  assert.equal((await C.verifyChain(tampered)).problem, "hash-mismatch");
  assert.equal((await C.verifyChain([log[0], log[2]])).ok, false);
  assert.equal((await C.verifyChain([log[1], log[0], log[2]])).ok, false);
});

test("hashdeep manifest format", () => {
  const m = C.hashdeepManifest([{ path: "./b.png", size: 3, sha256: "bb" }, { path: "./a.html", size: 10, sha256: "aa" }], { invokedFrom: "/case/artifacts" });
  const lines = m.trimEnd().split("\n");
  assert.equal(lines[0], "%%%% HASHDEEP-1.0");
  assert.equal(lines[1], "%%%% size,sha256,filename");
  assert.equal(lines[2], "## Invoked from: /case/artifacts");
  assert.deepEqual(lines.slice(5), ["10,aa,./a.html", "3,bb,./b.png"]);
  assert.throws(() => C.hashdeepManifest([{ path: "./a\nb", size: 1, sha256: "x" }]));
});

test("Timesketch JSONL has the required fields", async () => {
  const e1 = await C.chainEntry(null, "case-created", { name: "Op" }, "2026-11-12T01:02:03.004Z");
  const e2 = await C.chainEntry(e1, "artifact", { kind: "screenshot", path: "0001-screenshot.png", sha256: "f".repeat(64), url: `http://${ONION}/` }, "2026-11-12T01:02:04.000Z");
  const lines = C.timesketchJsonl({ id: "case-1", name: "Op" }, [e1, e2]).trimEnd().split("\n").map(JSON.parse);
  for (const l of lines) {
    assert.ok(l.message && l.datetime && l.timestamp_desc);
    assert.equal(typeof l.timestamp, "number");
  }
  assert.equal(lines[0].datetime, "2026-11-12T01:02:03.004Z");
  assert.equal(lines[0].timestamp, Date.parse("2026-11-12T01:02:03.004Z") * 1000);
  assert.equal(lines[1].sha256, "f".repeat(64));
  assert.match(lines[1].message, /Captured screenshot/);
});

test("onion leads extracted from TorBot/OnionSearch/darkdump-style output", () => {
  const csv = `"engine","name","link"\n"ahmia","A","http://${ONION}/path?x=1"\n"x","B","https://example.com/"\n` +
    `{"url": "${DDG}"}\n${ONION}\nhttp://expyuzz4wqqyqhjn.onion/\n`;
  const { leads, ignored } = C.extractOnionLeads(csv);
  assert.deepEqual(leads.map(l => l.url).sort(), [`http://${DDG}/`, `http://${ONION}/`, `http://${ONION}/path?x=1`].sort());
  assert.equal(ignored, 2); // example.com and the dead v2 onion
});

test("crypto addresses", () => {
  const t = "send to bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq or 1BoatSLRHtKNngkdXEeobR76b53LETtpyT; " +
    "eth 0x52908400098527886E0F7030069857D2E4169EE7; word Abcdefghijkmnopqrstuvwxyz";
  const k = C.findCryptoAddresses(t).map(x => x.kind);
  assert.deepEqual(k.sort(), ["bitcoin-bech32", "bitcoin-legacy", "ethereum"]);
});

test("page classifier: login, registration, captcha, payment, restriction, never submits", () => {
  const login = C.classifyPage({ url: `http://${ONION}/`, text: "Sign in", forms: [{ action: `http://${ONION}/login`, method: "post",
    submitText: "Log in", fields: [{ type: "text", name: "user" }, { type: "password", name: "pass" }] }] });
  assert.deepEqual(login.findings.map(f => f.kind), ["login"]);
  assert.match(login.note, /never fills in, submits, solves or bypasses/);
  const reg = C.classifyPage({ text: "Create account", forms: [{ action: "", fields: [{ type: "password", name: "p1" }, { type: "password", name: "p2" }] }] });
  assert.ok(reg.findings.some(f => f.kind === "registration"));
  assert.ok(!reg.findings.some(f => f.kind === "login"));
  const cap = C.classifyPage({ text: "", captcha: { elements: 1, hints: ["img#captcha"] } });
  assert.deepEqual(cap.findings.map(f => f.kind), ["captcha"]);
  const pay = C.classifyPage({ text: "Checkout", forms: [{ action: "https://pay.example.com/", fields: [{ type: "text", autocomplete: "cc-number" }] }] });
  assert.ok(pay.findings.some(f => f.kind === "payment"));
  assert.ok(pay.findings.some(f => f.kind === "clearnet-form"));
  const r403 = C.classifyPage({ text: "", httpStatus: 403 });
  assert.equal(r403.findings[0].kind, "access-restricted");
  const plain = C.classifyPage({ text: "Welcome to the library", forms: [] });
  assert.equal(plain.findings.length, 0);
  assert.match(plain.summary, /no logins/);
  const redir = C.classifyPage({ text: "", metaRefresh: "https://example.com/" });
  assert.match(redir.findings[0].explanation, /blocks it/);
});

test("case ids and artifact names are safe", () => {
  const id = C.newCaseId(new Date("2026-11-12T03:04:05Z"), () => 0);
  assert.equal(id, "case-20261112-030405-aaaaaa");
  assert.equal(C.artifactName(7, "dom", "html"), "0007-dom.html");
  assert.throws(() => C.artifactName(1, "../x", "html"));
  assert.equal(C.safeCaseName("  \u0000 "), "Untitled case");
});
