import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRequest,
  hostMatchesDomain,
  isOnionHostname,
  isValidV3OnionHostname,
  isKnownAdHost,
  isKnownTrackerHost,
  paymentProviderForHost
} from "../../modules/umbra/FilterRules.sys.mjs";

test("onion host classification is suffix-safe", () => {
  assert.equal(isOnionHostname("abcdefghijklmnop.onion"), true);
  assert.equal(isOnionHostname("abcdefghijklmnop.onion.example.com"), false);
  assert.equal(isOnionHostname("example.com"), false);
});

test("v3 onion host validation checks the 56-character base32 label", () => {
  assert.equal(isValidV3OnionHostname("a".repeat(56) + ".onion"), true);
  assert.equal(isValidV3OnionHostname("a".repeat(55) + ".onion"), false);
  // "1", "8", "9" and "0" are outside the RFC 4648 base32 alphabet (a-z, 2-7); "z" is valid.
  assert.equal(isValidV3OnionHostname("1".repeat(56) + ".onion"), false);
});

test("domain matching does not match lookalike suffixes", () => {
  assert.equal(hostMatchesDomain("ads.example.com", "example.com"), true);
  assert.equal(hostMatchesDomain("notexample.com", "example.com"), false);
});

test("known ad and tracker hosts are classified locally", () => {
  assert.equal(isKnownAdHost("pagead2.googlesyndication.com"), true);
  assert.equal(isKnownTrackerHost("www.google-analytics.com"), true);
  assert.equal(isKnownAdHost("googlesyndication.com.attacker.test"), false);
});

test("payment provider detection uses exact domain boundaries", () => {
  assert.equal(paymentProviderForHost("js.stripe.com"), "Stripe");
  assert.equal(paymentProviderForHost("stripe.com.attacker.test"), null);
});

test("first-party requests are allowed", () => {
  assert.deepEqual(
    classifyRequest({ hostname: "static.news.example", firstPartyHost: "news.example", resourceType: "script" }),
    { action: "allow", reason: "first-party" }
  );
});

test("known advertising resources are blocked without network lookups", () => {
  assert.deepEqual(
    classifyRequest({ hostname: "adservice.google.com", firstPartyHost: "publisher.example", resourceType: "script" }),
    { action: "block", reason: "known-ad-domain" }
  );
});

test("known trackers are blocked for subresources but not top-level documents", () => {
  assert.equal(classifyRequest({ hostname: "google-analytics.com", resourceType: "xmlhttprequest" }).action, "block");
  assert.equal(classifyRequest({ hostname: "google-analytics.com", resourceType: "document" }).action, "allow");
});

test("unknown metadata fails open rather than breaking navigation", () => {
  assert.equal(classifyRequest({ hostname: "", resourceType: "unknown" }).action, "allow");
  assert.equal(classifyRequest({ hostname: "unknown.example", resourceType: "other" }).action, "allow");
});
