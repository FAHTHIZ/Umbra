import test from "node:test";
import assert from "node:assert/strict";
import {
  HOST_RULES,
  findHostRule,
  hostMatches,
  isOnionHostname,
  normalizeHostname,
  paymentProviderForHost
} from "../../overlay/access/FilterRules.sys.mjs";

test("onion host recognition requires a 56-character v3 label", () => {
  assert.equal(isOnionHostname("a".repeat(56) + ".onion"), true);
  assert.equal(isOnionHostname("a".repeat(55) + ".onion"), false);
  assert.equal(isOnionHostname("abcdefghijklmnop.onion"), false);
  assert.equal(isOnionHostname("a".repeat(56) + ".onion.attacker.test"), false);\n  assert.equal(isOnionHostname("1".repeat(56) + ".onion"), false);\n  assert.equal(isOnionHostname("z".repeat(56) + ".onion"), true);
});

test("hostname normalization is stable", () => {
  assert.equal(normalizeHostname("Example.COM."), "example.com");
});

test("domain matching respects label boundaries", () => {
  assert.equal(hostMatches("ads.example.com", "example.com"), true);
  assert.equal(hostMatches("example.com", "example.com"), true);
  assert.equal(hostMatches("notexample.com", "example.com"), false);
  assert.equal(hostMatches("example.com.attacker.test", "example.com"), false);
});

test("starter ad and tracker rules match subdomains locally", () => {
  assert.equal(findHostRule("page.doubleclick.net")?.category, "ads");
  assert.equal(findHostRule("www.googlesyndication.com")?.category, "ads");
  assert.equal(findHostRule("www.google-analytics.com")?.category, "trackers");
  assert.equal(findHostRule("clarity.ms")?.category, "trackers");
  assert.equal(findHostRule("googlesyndication.com.attacker.test"), null);
});

test("payment provider detection uses exact domain boundaries", () => {
  assert.equal(paymentProviderForHost("js.stripe.com"), "Stripe");
  assert.equal(paymentProviderForHost("paypal.com"), "PayPal");
  assert.equal(paymentProviderForHost("stripe.com.attacker.test"), null);
  assert.equal(paymentProviderForHost("not-a-provider.example"), null);
});

test("starter rules remain a bounded local set", () => {
  assert.ok(HOST_RULES.length > 0);
  assert.ok(HOST_RULES.length < 100);
  assert.ok(HOST_RULES.every(rule => rule.domain && rule.category && rule.reason));
});
