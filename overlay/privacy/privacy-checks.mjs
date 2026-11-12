// Pure evaluation of a privacy snapshot -> UI model. No browser APIs here so
// it can be unit-tested under Node (tests/umbra/privacy-checks.test.mjs).

const PRIVATE_SEARCH = new Set([
  "OnionSearch", "DuckDuckGo", "DuckDuckGo (no AI)", "DuckDuckGo (.onion)",
  "Brave Search", "Brave Search (.onion)", "Startpage", "Startpage (.onion)", "Mojeek",
]);

export function evaluate(s) {
  const p = s.prefs || {};
  const rows = { tor: [], fp: [], data: [], search: [] };

  // --- Tor ------------------------------------------------------------------
  const connected = s.torStage === "Bootstrapped";
  rows.tor.push({
    label: "Tor connection",
    status: connected ? "ok" : s.torEnabled === false ? "warn" : "warn",
    value: connected ? "Connected" : s.torEnabled === false ? "Managed externally" : (s.torStage || "Not connected"),
    detail: connected
      ? "Websites see a Tor exit relay's address, not yours."
      : s.torEnabled === false
        ? "Tor is provided outside Umbra (system tor or Tails). Umbra still sends everything to the SOCKS proxy below."
        : "Nothing loads until Tor connects. Umbra never falls back to a direct connection.",
  });
  const socksOk = p["network.proxy.type"] === 1 && !!p["network.proxy.socks"] && p["network.proxy.socks_remote_dns"] !== false;
  rows.tor.push({
    label: "All traffic through Tor",
    status: socksOk ? "ok" : "bad",
    value: socksOk ? `SOCKS ${p["network.proxy.socks"]}:${p["network.proxy.socks_port"]}` : "Changed",
    detail: socksOk
      ? "Web traffic and DNS lookups go through the Tor SOCKS proxy."
      : "Proxy settings were changed. Traffic or DNS may bypass Tor. Reset network.proxy.* in about:config.",
  });
  const isolation = p["extensions.torbutton.use_nontor_proxy"] !== true;
  rows.tor.push({
    label: "Per-site circuits",
    status: isolation ? "ok" : "bad",
    value: isolation ? "On" : "Off",
    detail: isolation
      ? "Each site you visit uses its own Tor circuit, so exit relays can't link your activity across sites."
      : "A non-Tor proxy mode is enabled, which turns off circuit isolation.",
  });

  // --- Fingerprinting & security -------------------------------------------
  const rfp = p["privacy.resistFingerprinting"] !== false;
  rows.fp.push({
    label: "Fingerprinting protection",
    status: rfp ? "ok" : "bad",
    value: rfp ? "On" : "Off",
    detail: rfp
      ? "Umbra looks the same as every other Tor Browser user: same screen size buckets, fonts, timezone (UTC) and language."
      : "Turned off. Websites can now tell you apart from other Tor users. Reset privacy.resistFingerprinting.",
  });
  rows.fp.push({
    label: "Window letterboxing",
    status: p["privacy.resistFingerprinting.letterboxing"] === false ? "warn" : "ok",
    value: p["privacy.resistFingerprinting.letterboxing"] === false ? "Off" : "On",
    detail: "Rounds the page area to common sizes so your window size doesn't identify you.",
  });
  rows.fp.push({
    label: "WebRTC",
    status: p["media.peerconnection.enabled"] ? "bad" : "ok",
    value: p["media.peerconnection.enabled"] ? "Enabled" : "Disabled",
    detail: p["media.peerconnection.enabled"]
      ? "WebRTC can reveal local network details. It's off in Tor Browser by default."
      : "Peer-to-peer connections that could expose network details are unavailable to websites.",
  });
  const level = s.securityLevel || "unknown";
  const levelName = { standard: "Standard", safer: "Safer", safest: "Safest" }[level] || "Unknown";
  rows.fp.push({
    label: "Security level",
    status: s.securityCustom ? "warn" : level === "standard" ? "info" : "ok",
    value: s.securityCustom ? `${levelName} (custom)` : levelName,
    detail: s.securityCustom
      ? "Security settings were customised, which makes you stand out. Pick a level again to reset them."
      : level === "standard"
        ? "All site features work. Safer disables JavaScript on non-HTTPS sites and some fonts and media. Safest disables JavaScript everywhere."
        : "Some website features are disabled to reduce the attack surface.",
  });
  rows.fp.push({
    label: "HTTPS-Only",
    status: p["dom.security.https_only_mode"] === false ? "warn" : "ok",
    value: p["dom.security.https_only_mode"] === false ? "Off" : "On",
    detail: "Upgrades connections to HTTPS so the Tor exit relay can't read or modify pages. Onion sites are already end-to-end encrypted.",
  });

  // --- Data -------------------------------------------------------------------
  const pbm = p["browser.privatebrowsing.autoStart"] !== false;
  rows.data.push({
    label: "History & cookies",
    status: pbm ? "ok" : "info",
    value: pbm ? "Forgotten on close" : "Kept",
    detail: pbm
      ? "Umbra is in permanent private browsing. Closing it erases history, cookies and site data."
      : "You chose to keep history. Anyone with access to this device can see what you visited.",
  });
  rows.data.push({
    label: "Umbra telemetry",
    status: "ok",
    value: "None",
    detail: "Umbra's own pages make no network requests. There are no analytics, crash pings or usage reports.",
  });
  rows.data.push({
    label: "Access Engine filtering",
    status: p["umbra.access.enabled"] ? "info" : "ok",
    value: p["umbra.access.enabled"] ? "On" : "Off",
    detail: p["umbra.access.enabled"]
      ? "Blocks ads and trackers locally. Blocking changes which requests you make, so websites may be able to tell you apart from other Tor users."
      : "Off by default so you look like every other Tor Browser user.",
  });

  // --- Search -----------------------------------------------------------------
  const engine = s.search || "Unknown";
  const priv = PRIVATE_SEARCH.has(engine);
  rows.search.push({
    label: "Search provider",
    status: priv ? "ok" : "info",
    value: engine,
    detail: (priv
      ? `${engine} sees your search terms but, through Tor, not your IP address.`
      : `${engine} sees your search terms, and may profile searches within a session, but through Tor it doesn't see your IP address.`)
      + " The search provider and the anonymity network are separate things.",
  });
  rows.search.push({
    label: "Search suggestions",
    status: p["browser.search.suggest.enabled"] ? "info" : "ok",
    value: p["browser.search.suggest.enabled"] ? "On" : "Off",
    detail: p["browser.search.suggest.enabled"]
      ? "Each keystroke in the address bar is sent to your search provider."
      : "Nothing is sent to your search provider until you press Enter.",
  });

  const all = Object.values(rows).flat();
  const bad = all.filter(r => r.status === "bad").length;
  const warn = all.filter(r => r.status === "warn").length;
  const overall = bad
    ? { status: "bad", text: `${bad} protection${bad > 1 ? "s" : ""} weakened` }
    : warn
      ? { status: "warn", text: `${warn} item${warn > 1 ? "s" : ""} to review` }
      : { status: "ok", text: "Fully protected" };

  return {
    overall,
    version: `Umbra ${p["umbra.version"] || "?"} · based on Tor Browser ${p["umbra.upstream.torbrowser"] || "?"}`,
    groups: [
      { title: "Network", rows: rows.tor, actions: [["connection", "Tor connection settings"]] },
      { title: "Fingerprinting & security", rows: rows.fp, actions: [["security", "Security level"], ["privacy", "Privacy settings"]] },
      { title: "Your data", rows: rows.data, actions: [["access", "Access Engine"]] },
      { title: "Search", rows: rows.search, actions: [["search", "Change search provider"]] },
    ],
  };
}
