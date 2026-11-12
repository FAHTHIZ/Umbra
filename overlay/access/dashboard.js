import { Services } from "resource://gre/modules/Services.sys.mjs";
import { UmbraAccessEngine } from "resource:///modules/umbra/AccessEngine.sys.mjs";

const $ = id => document.getElementById(id);
const labels = {
  loginDetected: ["Login interface detected", "Authentication form metadata was found."],
  registrationDetected: ["Possible registration interface", "A password form and email field were found."],
  paywallDetected: ["Access or subscription wall detected", "This is a visual heuristic, not a bypass."],
  checkoutDetected: ["Checkout interface detected", "Payment form or checkout wording was found."],
  cookieDialogDetected: ["Cookie consent dialog detected", "Choose your consent preference on the website." ]
};

function addFinding(container, title, detail, warning = false) {
  const row = document.createElement("div");
  row.className = "finding" + (warning ? " warning" : "");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.textContent = warning ? "!" : "•";
  const body = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = detail;
  body.append(strong, small);
  row.append(dot, body);
  container.append(row);
}

function render() {
  const state = UmbraAccessEngine.getState();
  $("enabled").checked = state.enabled;
  $("block-ads").checked = state.blockAds;
  $("block-trackers").checked = state.blockTrackers;
  $("cosmetic").checked = state.cosmetic;
  $("ads-count").textContent = state.blockedAds;
  $("trackers-count").textContent = state.blockedTrackers;
  $("overlays-count").textContent = state.removedOverlays;
  $("onion-count").textContent = state.onionPagesInspected;
  $("engine-status").textContent = state.enabled ? "Filtering enabled" : "Inspection active · filtering off";
  $("page-kind").textContent = !state.contextAvailable
    ? "No HTTP(S) page context available."
    : state.contextIsOnion
      ? "Current page is an onion service. Its address is intentionally not displayed here."
      : "Current page inspected locally. Its address is intentionally not displayed here.";
  $("exception").disabled = !state.contextAvailable;
  $("exception").textContent = state.exceptionActive ? "Remove temporary site exception" : "Add temporary site exception";
  $("reader").disabled = !state.contextAvailable;
  const findings = $("findings");
  findings.replaceChildren();
  const page = state.latestPage || {};
  let found = false;
  for (const [key, [title, detail]] of Object.entries(labels)) {
    if (page[key]) {
      addFinding(findings, title, detail);
      found = true;
    }
  }
  for (const provider of page.paymentProviders || []) {
    addFinding(findings, "Payment provider identified: " + provider, "Identified from local script, iframe or form destination metadata.");
    found = true;
  }
  for (const scheme of page.paymentUriTypes || []) {
    addFinding(findings, "Payment URI detected: " + scheme + ":", "Only the URI scheme is retained; the payment address itself is not collected.");
    found = true;
  }
  for (const indicator of page.suspiciousIndicators || []) {
    const descriptions = {
      "insecure-payment-action": "A card-related form appears to submit over ordinary HTTP.",
      "unrecognized-payment-destination": "A card-related form submits to an unrecognized external host.",
      "invalid-payment-destination": "A card-related form has an invalid destination."
    };
    addFinding(findings, "Checkout warning", descriptions[indicator] || "Indicator: " + indicator, true);
    found = true;
  }
  for (const indicator of page.redirectIndicators || []) {
    const descriptions = {
      "redirect-non-web-scheme": "A meta-refresh target uses a non-web scheme.",
      "redirect-credentials-in-url": "A meta-refresh target embeds a username or password in its URL.",
      "redirect-downgrade": "An HTTPS page contains a meta-refresh target that downgrades to ordinary HTTP.",
      "redirect-to-ip-literal": "A meta-refresh target points directly to an IP address.",
      "cross-origin-meta-refresh": "A meta-refresh target changes the page origin. This may be legitimate.",
      "invalid-meta-refresh-target": "A meta-refresh target could not be parsed."
    };
    addFinding(findings, "Redirect indicator", descriptions[indicator] || "Unclassified redirect indicator.", true);
    found = true;
  }
  if (!found) addFinding(findings, "No supported indicators detected", "This does not prove that the page is safe or that no tracker is present.");
}

$("enabled").addEventListener("change", event => UmbraAccessEngine.setEnabled(event.target.checked));
$("block-ads").addEventListener("change", event => UmbraAccessEngine.setCategoryEnabled("ads", event.target.checked));
$("block-trackers").addEventListener("change", event => UmbraAccessEngine.setCategoryEnabled("trackers", event.target.checked));
$("cosmetic").addEventListener("change", event => UmbraAccessEngine.setCategoryEnabled("cosmetic", event.target.checked));
$("exception").addEventListener("click", () => {
  const state = UmbraAccessEngine.getState();
  UmbraAccessEngine.setTemporaryException(!state.exceptionActive);
});
$("reader").addEventListener("click", () => UmbraAccessEngine.openReaderView());
$("clear").addEventListener("click", () => UmbraAccessEngine.clearCounters());
$("alternative-form").addEventListener("submit", event => {
  event.preventDefault();
  const query = $("alternative-query").value.trim();
  if (query) UmbraAccessEngine.searchOnionSearch(query);
});

const observer = { observe() { render(); } };
Services.obs.addObserver(observer, "umbra-access-state-changed");
window.addEventListener("unload", () => {
  try { Services.obs.removeObserver(observer, "umbra-access-state-changed"); } catch (_) {}
}, { once: true });
render();
