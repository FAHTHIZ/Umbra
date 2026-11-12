import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, evaluateRelease, parseVersion } from "../../overlay/update/version.mjs";

test("semver ordering", () => {
  assert.ok(compareVersions("0.1.1", "0.1.0") > 0);
  assert.ok(compareVersions("v0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
  assert.ok(compareVersions("1.0.0-beta", "1.0.0-alpha") > 0);
  assert.equal(compareVersions("0.1.0", "v0.1.0"), 0);
  assert.ok(compareVersions("0.1.0", "0.1.1") < 0);
});

test("garbage never counts as newer", () => {
  assert.equal(parseVersion("latest"), null);
  assert.equal(compareVersions("99999", "0.1.0"), 0);
  assert.equal(evaluateRelease({ tag_name: "<script>" }, "0.1.0"), null);
});

test("only newer, published, non-prerelease releases notify", () => {
  assert.deepEqual(evaluateRelease({ tag_name: "v0.2.0" }, "0.1.0"),
    { version: "0.2.0", url: "https://github.com/FAHTHIZ/Umbra/releases/tag/v0.2.0" });
  assert.equal(evaluateRelease({ tag_name: "v0.1.0" }, "0.1.0"), null);
  assert.equal(evaluateRelease({ tag_name: "v0.2.0", prerelease: true }, "0.1.0"), null);
  assert.equal(evaluateRelease({ tag_name: "v0.2.0", draft: true }, "0.1.0"), null);
  assert.equal(evaluateRelease(null, "0.1.0"), null);
});

test("link is built from a fixed URL, never from the response", () => {
  const r = evaluateRelease({ tag_name: "v0.2.0", html_url: "https://evil.example/" }, "0.1.0");
  assert.ok(r.url.startsWith("https://github.com/FAHTHIZ/Umbra/releases/tag/"));
});
