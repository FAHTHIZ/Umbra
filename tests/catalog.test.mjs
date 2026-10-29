import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { filterResources, isSafeWebUrl, isV3OnionUrl, validateCatalog } from "../site/src/catalog.mjs";

const catalogPath = fileURLToPath(new URL("../site/data/catalog.json", import.meta.url));
const rawCatalog = JSON.parse(await readFile(catalogPath, "utf8"));

test("bundled catalogue passes strict validation", () => {
  assert.equal(validateCatalog(rawCatalog).length, rawCatalog.length);
});
test("catalogue IDs are unique and every entry has source provenance", () => {
  assert.equal(new Set(rawCatalog.map(item => item.id)).size, rawCatalog.length);
  assert.ok(rawCatalog.every(item => item.verifiedBy && item.evidenceUrl));
});
test("all onion records use valid v3 onion hostnames", () => {
  const records = rawCatalog.filter(item => item.kind === "onion");
  assert.ok(records.length >= 4);
  for (const item of records) assert.equal(isV3OnionUrl(item.url), true, item.id + " should be a valid v3 onion address");
});
test("normal catalogue links must be HTTPS and cannot silently point to onion hosts", () => {
  assert.equal(isSafeWebUrl("https://example.org/research"), true);
  assert.equal(isSafeWebUrl("http://example.org"), false);
  assert.equal(isSafeWebUrl("https://user:pass@example.org"), false);
  assert.equal(isSafeWebUrl("https://example.onion"), false);
  assert.equal(isV3OnionUrl("http://example.com"), false);
  assert.equal(isV3OnionUrl("http://aaaaaaaaaaaaaaaa.onion"), false);
});
test("local search matches source titles and tags", () => {
  assert.ok(filterResources(rawCatalog, "Tor Project").length > 0);
  assert.ok(filterResources(rawCatalog, "journalism").length > 0);
  assert.equal(filterResources(rawCatalog, "term-that-should-not-match").length, 0);
});
test("category filters only return requested category records", () => {
  const results = filterResources(rawCatalog, "", "whistleblower");
  assert.ok(results.length > 0);
  assert.ok(results.every(item => item.category === "whistleblower"));
});
test("validation rejects malformed and duplicate entries", () => {
  assert.throws(() => validateCatalog([]), /non-empty array/);
  assert.throws(() => validateCatalog([rawCatalog[0], rawCatalog[0]]), /Duplicate record id/);
  const malformed = { ...rawCatalog[0], url: "javascript:alert(1)" };
  assert.throws(() => validateCatalog([malformed]), /Unsafe or malformed destination/);
});
