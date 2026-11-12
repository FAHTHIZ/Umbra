import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPaymentURI,
  inspectMetaRefreshRedirect
} from "../../overlay/access/AccessSignals.sys.mjs";

test("payment URI detection returns only a recognized scheme", () => {
  assert.equal(classifyPaymentURI("bitcoin:bc1qexample"), "bitcoin");
  assert.equal(classifyPaymentURI("ethereum:0x1234"), "ethereum");
  assert.equal(classifyPaymentURI("lightning:lnbc123"), "lightning");
  assert.equal(classifyPaymentURI("monero:4example"), "monero");
  assert.equal(classifyPaymentURI("https://example.test/pay"), null);
  assert.equal(classifyPaymentURI("javascript:alert(1)"), null);
  assert.equal(classifyPaymentURI("x".repeat(5000)), null);
});

test("meta-refresh inspection reports cross-origin targets without exposing URLs", () => {
  const indicators = inspectMetaRefreshRedirect(
    "https://other.example/path?source=private",
    "https://publisher.example/article"
  );
  assert.deepEqual(indicators, ["cross-origin-meta-refresh"]);
  assert.equal(JSON.stringify(indicators).includes("private"), false);
});

test("meta-refresh inspection catches HTTPS downgrade but exempts onion HTTP", () => {
  const downgrade = inspectMetaRefreshRedirect(
    "http://checkout.example/pay",
    "https://publisher.example/article"
  );
  assert.ok(downgrade.includes("redirect-downgrade"));

  const onion = inspectMetaRefreshRedirect(
    "http://" + "a".repeat(56) + ".onion/pay",
    "https://publisher.example/article"
  );
  assert.equal(onion.includes("redirect-downgrade"), false);
});

test("meta-refresh inspection flags embedded credentials and IP-literal targets", () => {
  const credentials = inspectMetaRefreshRedirect(
    "https://user:pass@payment.example/",
    "https://publisher.example/"
  );
  assert.ok(credentials.includes("redirect-credentials-in-url"));

  const ip = inspectMetaRefreshRedirect(
    "https://192.0.2.10/pay",
    "https://publisher.example/"
  );
  assert.ok(ip.includes("redirect-to-ip-literal"));
});

test("meta-refresh inspection rejects non-web schemes", () => {
  const result = inspectMetaRefreshRedirect(
    "javascript:alert(1)",
    "https://publisher.example/"
  );
  assert.deepEqual(result, ["redirect-non-web-scheme"]);
});
