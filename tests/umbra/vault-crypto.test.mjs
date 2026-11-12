import test from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, checkPassphrase, simplifyBookmarks, countBookmarks, validatePayload } from "../../overlay/vault/vault-crypto.mjs";

const PASS = "correct horse battery staple";
const payload = { kind: "umbra-vault-payload", schema: 1, bookmarks: { title: "", children: [{ title: "a", url: "https://a.example/" }] }, logins: [{ origin: "https://a.example", password: "pw" }] };

test("round trip", async () => {
  const f = await encrypt(payload, PASS, { iterations: 100000 });
  assert.deepEqual(await decrypt(f, PASS), payload);
});

test("wrong passphrase rejected", async () => {
  const f = await encrypt(payload, PASS, { iterations: 100000 });
  await assert.rejects(decrypt(f, PASS + "x"), /Wrong passphrase/);
});

test("header tampering detected (AAD)", async () => {
  const f = JSON.parse(await encrypt(payload, PASS, { iterations: 100000 }));
  f.kdf.iterations = 100001;
  await assert.rejects(decrypt(JSON.stringify(f), PASS), /Wrong passphrase, or the file was changed/);
});

test("ciphertext tampering detected", async () => {
  const f = JSON.parse(await encrypt(payload, PASS, { iterations: 100000 }));
  const c = f.ciphertext;
  f.ciphertext = (c[0] === "A" ? "B" : "A") + c.slice(1);
  await assert.rejects(decrypt(JSON.stringify(f), PASS), /changed/);
});

test("default uses 600k iterations and fresh salt/iv", async () => {
  const a = JSON.parse(await encrypt(payload, PASS));
  const b = JSON.parse(await encrypt(payload, PASS));
  assert.equal(a.kdf.iterations, 600000);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.cipher.iv, b.cipher.iv);
  assert.ok(!JSON.stringify(a).includes("a.example"));
});

test("weak params and foreign files refused", async () => {
  const f = JSON.parse(await encrypt(payload, PASS, { iterations: 100000 }));
  f.kdf.iterations = 1000;
  await assert.rejects(decrypt(JSON.stringify(f), PASS), /Unsupported/);
  await assert.rejects(decrypt("{}", PASS), /isn't an Umbra Vault/);
  await assert.rejects(decrypt("nope", PASS), /isn't an Umbra Vault/);
});

test("passphrase policy", async () => {
  assert.ok(checkPassphrase("short"));
  assert.equal(checkPassphrase(PASS), null);
  await assert.rejects(encrypt(payload, "short"), /at least 12/);
});

test("bookmark simplification drops javascript:/place: and empty folders", () => {
  const raw = { title: "", children: [
    { title: "Menu", children: [{ title: "x", uri: "https://x.example/" }, { title: "js", uri: "javascript:alert(1)" }] },
    { title: "Empty", children: [{ title: "q", uri: "place:sort=8" }] },
  ] };
  const s = simplifyBookmarks(raw);
  assert.deepEqual(s, { title: "", children: [{ title: "Menu", children: [{ title: "x", url: "https://x.example/" }] }] });
  assert.equal(countBookmarks(s), 1);
});

test("payload validation rejects non-web URLs", () => {
  assert.throws(() => validatePayload({ ...payload, bookmarks: { title: "", children: [{ title: "j", url: "javascript:1" }] } }));
  assert.equal(validatePayload(payload), payload);
});
