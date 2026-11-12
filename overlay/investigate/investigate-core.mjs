// Umbra Investigate: pure logic shared by the browser module, the dashboard and Node tests.
// No Gecko APIs here. Hashing uses WebCrypto (NSS in Umbra, OpenSSL in Node).
//
// Design rules (docs/modules/INVESTIGATE.md):
//  - onion-only: every http(s)/ws(s) destination must be a v3 .onion host
//  - nothing is ever submitted on the user's behalf; inspection is read-only
//  - evidence is hashed (SHA-256) and appended to a hash-chained case log
//  - secrets in headers (cookies, authorization) are redacted before logging

export const CORE_VERSION = 1;

const te = new TextEncoder();

// ---------------------------------------------------------------- onion policy

/** v3 onion host, optionally with subdomains (www.<56>.onion). Syntax check only. */
const ONION_V3 = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z2-7]{56}\.onion$/;
const ONION_ANY = /\.onion$/;

export function normalizeHost(host) {
  return String(host ?? "").trim().toLowerCase().replace(/\.+$/, "");
}

export function isOnionHost(host) {
  return ONION_V3.test(normalizeHost(host));
}

/** Schemes that never leave the device on their own (their subresources are checked separately). */
export const INTERNAL_SCHEMES = Object.freeze([
  "about", "chrome", "resource", "moz-extension", "moz-icon", "moz-src", "moz-page-thumb",
  "data", "blob", "javascript", "view-source", "file", "page-icon", "cached-favicon", "jar",
]);
export const NETWORK_SCHEMES = Object.freeze(["http", "https", "ws", "wss"]);

export const REASONS = Object.freeze({
  internal: "Local browser page; no network involved.",
  onion: "Onion service: reached inside the Tor network, no exit relay.",
  "clearnet-blocked": "Ordinary (clearnet) website. Investigate mode is onion-only, so this request was stopped before any connection was made.",
  "onion-v2-blocked": "Not a valid v3 onion address. (Version 2 onion addresses were retired by Tor in 2021 and cannot be reached.)",
  "ip-literal-blocked": "Raw IP address. Investigate mode only connects to onion services.",
  "localhost-blocked": "Local address. Blocked so pages cannot probe services on this device or network.",
  "scheme-blocked": "This protocol can bypass the Tor proxy or is not supported in Investigate mode.",
  "invalid-url": "The address could not be parsed.",
});

function parse(url) {
  try {
    return new URL(String(url));
  } catch (_) {
    return null;
  }
}

function isIpLiteral(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || /^[0-9a-f:]+$/i.test(host) && host.includes(":");
}

/**
 * Decide whether a URL may be loaded in onion-only mode.
 * @returns {{allow: boolean, reason: keyof REASONS, host: string, scheme: string}}
 */
export function guardDecision(url) {
  const u = parse(url);
  if (!u) return { allow: false, reason: "invalid-url", host: "", scheme: "" };
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const host = normalizeHost(u.hostname);
  if (INTERNAL_SCHEMES.includes(scheme)) {
    return { allow: true, reason: "internal", host, scheme };
  }
  if (!NETWORK_SCHEMES.includes(scheme)) {
    return { allow: false, reason: "scheme-blocked", host, scheme };
  }
  if (isOnionHost(host)) return { allow: true, reason: "onion", host, scheme };
  if (ONION_ANY.test(host)) return { allow: false, reason: "onion-v2-blocked", host, scheme };
  if (host === "localhost" || host.endsWith(".localhost")) return { allow: false, reason: "localhost-blocked", host, scheme };
  if (isIpLiteral(host)) {
    const loop = /^127\./.test(host) || host === "[::1]" || host === "::1" || /^0\./.test(host);
    return { allow: false, reason: loop ? "localhost-blocked" : "ip-literal-blocked", host, scheme };
  }
  return { allow: false, reason: "clearnet-blocked", host, scheme };
}

export function explain(reason) {
  return REASONS[reason] ?? reason;
}

// ---------------------------------------------------------------- headers

export const SENSITIVE_HEADERS = Object.freeze([
  "cookie", "set-cookie", "authorization", "proxy-authorization", "x-csrf-token", "x-xsrf-token",
]);

/** Keep header names, drop secret values. Investigation logs never store session secrets. */
export function redactHeaders(headers) {
  return (headers || []).map(({ name, value }) => {
    const v = String(value ?? "");
    return SENSITIVE_HEADERS.includes(String(name).toLowerCase())
      ? { name, value: `[redacted by Umbra: ${te.encode(v).length} bytes]` }
      : { name, value: v };
  });
}

// ---------------------------------------------------------------- HAR 1.2

function queryString(url) {
  const u = parse(url);
  return u ? [...u.searchParams].map(([name, value]) => ({ name, value })) : [];
}

/**
 * Traffic records -> HAR 1.2 (readable by mitmproxy, ZAP, browser devtools).
 * Blocked requests are kept as entries with status 0 and `_umbraBlocked`.
 */
export function toHar(records, { creatorVersion = "0", browser = { name: "Umbra", version: "0" }, comment = "" } = {}) {
  const entries = records.map(r => {
    const resHeaders = r.responseHeaders || [];
    const mime = r.mimeType || resHeaders.find(h => h.name.toLowerCase() === "content-type")?.value || "";
    const e = {
      startedDateTime: r.started,
      time: Math.max(0, r.time ?? 0),
      request: {
        method: r.method || "GET",
        url: r.url,
        httpVersion: r.httpVersion || "HTTP/1.1",
        cookies: [],
        headers: r.requestHeaders || [],
        queryString: queryString(r.url),
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: r.blocked ? 0 : (r.status ?? 0),
        statusText: r.blocked ? "Blocked by Umbra Investigate" : (r.statusText || ""),
        httpVersion: r.httpVersion || "HTTP/1.1",
        cookies: [],
        headers: resHeaders,
        content: { size: r.size ?? -1, mimeType: mime },
        redirectURL: resHeaders.find(h => h.name.toLowerCase() === "location")?.value || "",
        headersSize: -1,
        bodySize: r.size ?? -1,
      },
      cache: {},
      timings: { send: 0, wait: Math.max(0, r.time ?? 0), receive: 0 },
    };
    if (r.blocked) e._umbraBlocked = r.blocked;
    if (r.type) e._resourceType = r.type;
    return e;
  });
  return {
    log: {
      version: "1.2",
      creator: { name: "Umbra Investigate", version: String(creatorVersion) },
      browser,
      pages: [],
      entries,
      comment: comment || "Request/response metadata only (no bodies). Cookie and Authorization values are redacted.",
    },
  };
}

// ---------------------------------------------------------------- hashing

export function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data) {
  const bytes = typeof data === "string" ? te.encode(data) : data;
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

/** Deterministic JSON: object keys sorted recursively. Used for the hash chain. */
export function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ":" + canonicalJson(v[k])).join(",") + "}";
}

export const GENESIS = "0".repeat(64);

/** Append an entry to a hash-chained log: hash = SHA-256(canonical({seq,time,type,data,prev})). */
export async function chainEntry(prevEntry, type, data, time = new Date().toISOString()) {
  const body = { seq: prevEntry ? prevEntry.seq + 1 : 1, time, type, data, prev: prevEntry ? prevEntry.hash : GENESIS };
  return { ...body, hash: await sha256Hex(canonicalJson(body)) };
}

/** @returns {{ok: boolean, count: number, brokenAt: number|null, problem: string|null}} */
export async function verifyChain(entries) {
  let prev = null;
  for (const e of entries) {
    const expectPrev = prev ? prev.hash : GENESIS;
    const expectSeq = prev ? prev.seq + 1 : 1;
    if (e.prev !== expectPrev) return { ok: false, count: entries.length, brokenAt: e.seq, problem: "prev-mismatch" };
    if (e.seq !== expectSeq) return { ok: false, count: entries.length, brokenAt: e.seq, problem: "seq-gap" };
    const { hash, ...body } = e;
    if (await sha256Hex(canonicalJson(body)) !== hash) {
      return { ok: false, count: entries.length, brokenAt: e.seq, problem: "hash-mismatch" };
    }
    prev = e;
  }
  return { ok: true, count: entries.length, brokenAt: null, problem: null };
}

// ---------------------------------------------------------------- hashdeep / Timesketch

/**
 * hashdeep-compatible manifest (HASHDEEP-1.0, size + sha256). Audit with:
 *   cd <case>/artifacts && hashdeep -c sha256 -a -k ../hashdeep.txt -l -r .
 * @param files [{path: "./0001-dom.html", size, sha256}]
 */
export function hashdeepManifest(files, { invokedFrom = ".", command = "umbra-investigate export" } = {}) {
  const lines = [
    "%%%% HASHDEEP-1.0",
    "%%%% size,sha256,filename",
    `## Invoked from: ${invokedFrom}`,
    `## $ ${command}`,
    "##",
  ];
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (/[\r\n,]/.test(f.path) && !/^"/.test(f.path)) throw new Error("unsupported filename: " + f.path);
    lines.push(`${f.size},${f.sha256},${f.path}`);
  }
  return lines.join("\n") + "\n";
}

/** Case log -> Timesketch JSONL (required: message, datetime, timestamp_desc). */
export function timesketchJsonl(caseInfo, entries) {
  return entries.map(e => {
    const d = e.data || {};
    const ms = Date.parse(e.time);
    const ev = {
      message: timelineMessage(e),
      datetime: new Date(ms).toISOString(),
      timestamp: ms * 1000,
      timestamp_desc: TIMESTAMP_DESC[e.type] || "Umbra case event",
      data_type: `umbra:investigate:${e.type}`,
      case_id: caseInfo.id,
      case_name: caseInfo.name,
      seq: e.seq,
      entry_hash: e.hash,
    };
    if (d.url) ev.url = d.url;
    if (d.sha256) ev.sha256 = d.sha256;
    if (d.path) ev.artifact = d.path;
    return JSON.stringify(ev);
  }).join("\n") + (entries.length ? "\n" : "");
}

const TIMESTAMP_DESC = {
  "case-created": "Case created",
  artifact: "Evidence captured",
  inspection: "Page inspected",
  note: "Investigator note",
  "lead-import": "Leads imported",
  "external-tool": "External tool output attached",
  export: "Case exported",
};

function timelineMessage(e) {
  const d = e.data || {};
  switch (e.type) {
    case "case-created": return `Case "${d.name}" created`;
    case "artifact": return `Captured ${d.kind} of ${d.url || "page"} (${d.path}, sha256 ${String(d.sha256).slice(0, 16)}…)`;
    case "inspection": return `Inspected ${d.url}: ${(d.kinds || []).join(", ") || "no access controls found"}`;
    case "note": return `Note: ${String(d.text || "").slice(0, 200)}`;
    case "lead-import": return `Imported ${d.count} onion leads (${d.ignored} non-onion entries ignored)`;
    case "external-tool": return `Attached ${d.tool} output ${d.path}`;
    case "export": return `Exported ${d.what}`;
    default: return e.type;
  }
}

// ---------------------------------------------------------------- leads

const LEAD_RE = /(?:(https?):\/\/)?((?:[a-z0-9-]+\.)*[a-z2-7]{56}\.onion)(:\d{1,5})?((?:\/[^\s"'<>,;|\]\)]*)?)/gi;
const URLISH_RE = /\bhttps?:\/\/[^\s"'<>,;|]+/gi;

/** Extract onion URLs from any tool output (CSV, JSON, text). Non-onion URLs are counted, not kept. */
export function extractOnionLeads(text, max = 5000) {
  const s = String(text ?? "");
  const seen = new Map();
  for (const m of s.matchAll(LEAD_RE)) {
    const scheme = (m[1] || "http").toLowerCase();
    const host = m[2].toLowerCase();
    if (!isOnionHost(host)) continue;
    const url = `${scheme}://${host}${m[3] || ""}${m[4] || "/"}`;
    if (!seen.has(url)) seen.set(url, { url, host });
    if (seen.size >= max) break;
  }
  let ignored = 0;
  for (const m of s.matchAll(URLISH_RE)) {
    const u = parse(m[0]);
    if (u && !isOnionHost(u.hostname)) ignored++;
  }
  return { leads: [...seen.values()], ignored };
}

// ---------------------------------------------------------------- page inspection

const WORDS = {
  login: /\b(log ?in|sign ?in|password|passphrase|username|user name|authenticate|2fa|one-time code|otp)\b/i,
  register: /\b(register|sign ?up|create (an )?account|join now|registration|invite code|referral code)\b/i,
  payment: /\b(checkout|pay(ment)? now|add to cart|deposit|escrow|wallet|invoice|subscribe|purchase|buy now|billing)\b/i,
  restricted: /\b(access denied|members only|invite[- ]only|forbidden|not authori[sz]ed|login required|account required|restricted area|banned)\b/i,
  captcha: /\b(captcha|are you (a )?human|prove you are human|verify you are human|bot check|anti-?bot|ddos protection|queue)\b/i,
};

export const CRYPTO_PATTERNS = Object.freeze([
  { kind: "bitcoin-bech32", re: /\b(bc1[ac-hj-np-z02-9]{11,71})\b/g },
  { kind: "bitcoin-legacy", re: /\b([13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { kind: "monero", re: /\b(4[0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/g },
  { kind: "ethereum", re: /\b(0x[a-fA-F0-9]{40})\b/g },
]);

export function findCryptoAddresses(text, max = 50) {
  const out = [];
  const seen = new Set();
  for (const { kind, re } of CRYPTO_PATTERNS) {
    for (const m of String(text ?? "").matchAll(re)) {
      if (seen.has(m[1])) continue;
      // legacy BTC: require mixed case or digits to cut false positives on words
      if (kind === "bitcoin-legacy" && !(/[0-9]/.test(m[1]) && /[a-z]/.test(m[1]) && /[A-Z]/.test(m[1]))) continue;
      seen.add(m[1]);
      out.push({ kind, value: m[1] });
      if (out.length >= max) return out;
    }
  }
  return out;
}

const CAPTCHA_HINT = /captcha|recaptcha|hcaptcha|turnstile|cf-challenge|g-recaptcha|ddos-guard|anti-?bot|challenge/i;
const STATUS = {
  401: "The server requires authentication (HTTP 401). Umbra will not try credentials.",
  402: "The server asks for payment (HTTP 402).",
  403: "The server refuses access (HTTP 403). This can be an access policy, geo/abuse filter or anti-bot system.",
  407: "A proxy requires authentication (HTTP 407).",
  429: "Rate limited (HTTP 429). Wait before retrying; Umbra never retries automatically.",
  451: "Unavailable for legal reasons (HTTP 451).",
};

export const NEVER_SUBMITS =
  "Umbra only describes what it sees. It never fills in, submits, solves or bypasses anything; any action on this page happens only if you do it yourself.";

function finding(kind, title, explanation, evidence = []) {
  return { kind, title, explanation, evidence: evidence.slice(0, 20) };
}

/**
 * Classify a page descriptor produced by UmbraInvestigateChild (structure only, no field values).
 * @returns {{url, findings: Array<{kind,title,explanation,evidence}>, summary, note}}
 */
export function classifyPage(d) {
  const f = [];
  const text = String(d.text || "");
  const forms = d.forms || [];
  const fields = forms.flatMap(x => x.fields || []);
  const pw = fields.filter(x => x.type === "password");
  const formsWithPw = forms.filter(x => (x.fields || []).some(y => y.type === "password"));

  const regForm = formsWithPw.find(x => (x.fields || []).filter(y => y.type === "password").length >= 2 ||
    (x.fields || []).some(y => /new-password/.test(y.autocomplete || "") || /confirm|repeat|again|verify/i.test(`${y.name} ${y.id} ${y.label}`)) ||
    WORDS.register.test(`${x.submitText} ${x.action}`));
  if (regForm) {
    f.push(finding("registration", "Registration form",
      "This page asks you to create an account (multiple password fields or sign-up wording). Creating accounts during an investigation may be logged by the operator and can tie your sessions together.",
      [`form → ${regForm.action || "(same page)"}`, `${(regForm.fields || []).length} fields`]));
  }
  const loginForms = formsWithPw.filter(x => x !== regForm);
  if (loginForms.length || (!regForm && pw.length)) {
    f.push(finding("login", "Login form",
      "This page contains a password field. Umbra does not store, fill or submit credentials, and Investigate profiles never save passwords.",
      loginForms.map(x => `${x.method || "get"} → ${x.action || "(same page)"}`)));
  } else if (!regForm && WORDS.login.test(text) && !pw.length && /\b(log ?in|sign ?in)\b/i.test(text)) {
    f.push(finding("login-link", "Login mentioned",
      "The page mentions signing in but has no password field here; the login is probably on another page.", []));
  }

  const capEls = (d.captcha?.elements || 0);
  const capHints = d.captcha?.hints || [];
  if (capEls > 0 || capHints.length || WORDS.captcha.test(text) || (d.iframes || []).some(s => CAPTCHA_HINT.test(s))) {
    f.push(finding("captcha", "CAPTCHA or bot check",
      "The site uses a human-verification or anti-DDoS step. Solve it yourself if you choose to continue; Umbra does not solve or bypass CAPTCHAs. Many onion sites use these queues against DDoS, not against you.",
      capHints.concat((d.iframes || []).filter(s => CAPTCHA_HINT.test(s)))));
  }

  const cardFields = fields.filter(x => /^cc-/.test(x.autocomplete || "") || /card.?(number|num)|cvv|cvc|expir/i.test(`${x.name} ${x.id}`));
  const crypto = findCryptoAddresses(text);
  const payLinks = d.paymentLinks || [];
  if (cardFields.length || payLinks.length || WORDS.payment.test(text)) {
    f.push(finding("payment", "Payment or checkout",
      "The page asks for payment or shows a checkout/deposit flow. Umbra never initiates payments. Treat payment requests on unknown onion services as high risk.",
      cardFields.map(x => `card field: ${x.name || x.id || x.autocomplete}`).concat(payLinks.map(p => `payment link: ${p}:`))));
  }
  if (crypto.length) {
    f.push(finding("crypto-address", "Cryptocurrency addresses",
      "Wallet addresses are visible on the page. They are public data and are listed here as possible leads; Umbra records them only if you capture evidence.",
      crypto.map(c => `${c.kind}: ${c.value}`)));
  }

  if (STATUS[d.httpStatus]) {
    f.push(finding("access-restricted", `HTTP ${d.httpStatus}`, STATUS[d.httpStatus], []));
  } else if (WORDS.restricted.test(text)) {
    f.push(finding("access-restricted", "Access restriction",
      "The page says access is restricted (members only, invite only, denied or banned). Umbra does not attempt to get around access controls.",
      [(text.match(WORDS.restricted) || [""])[0]]));
  }

  const uploads = fields.filter(x => x.type === "file");
  if (uploads.length) {
    f.push(finding("file-upload", "File upload",
      "The page accepts file uploads. Uploaded files can contain metadata (names, authors, GPS, device). Strip metadata first if you ever upload anything.", []));
  }
  const clearForms = forms.filter(x => x.action && !guardDecision(x.action).allow);
  if (clearForms.length) {
    f.push(finding("clearnet-form", "Form posts to a non-onion address",
      "Submitting this form would leave the onion network, so Investigate mode would block it.",
      clearForms.map(x => x.action)));
  }
  if (d.metaRefresh) {
    const g = guardDecision(d.metaRefresh);
    f.push(finding("redirect", "Automatic redirect",
      g.allow ? "The page redirects automatically to another onion address." :
        "The page tries to redirect to a non-onion address; Investigate mode blocks it.", [d.metaRefresh]));
  }
  if ((d.clearnetRefs || 0) > 0) {
    f.push(finding("clearnet-references", "Clearnet references",
      `The page references ${d.clearnetRefs} non-onion resource(s) or link(s). Investigate mode blocks loading them; following such links requires leaving Investigate mode.`, []));
  }

  const kinds = f.map(x => x.kind);
  return {
    url: d.url,
    title: d.title,
    findings: f,
    summary: kinds.length ? kinds.join(", ") : "no logins, CAPTCHAs, payments or access restrictions detected",
    counts: { forms: forms.length, fields: fields.length, passwordFields: pw.length, iframes: (d.iframes || []).length,
      onionRefs: d.onionRefs || 0, clearnetRefs: d.clearnetRefs || 0 },
    note: NEVER_SUBMITS,
  };
}

// ---------------------------------------------------------------- cases

export function newCaseId(now = new Date(), rand = Math.random) {
  const p = n => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const r = Array.from({ length: 6 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rand() * 32)]).join("");
  return `case-${stamp}-${r}`;
}

export function safeCaseName(name) {
  const s = String(name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120);
  return s || "Untitled case";
}

/** Artifact file name: zero-padded capture number + kind + extension. */
export function artifactName(n, kind, ext) {
  if (!/^[a-z0-9-]+$/.test(kind) || !/^[a-z0-9]+$/.test(ext)) throw new Error("bad artifact name");
  return `${String(n).padStart(4, "0")}-${kind}.${ext}`;
}
