// Umbra Investigate dashboard. Privileged chrome page; every page-derived string is
// rendered with textContent (never innerHTML).
import * as Core from "chrome://browser/content/umbra-investigate/investigate-core.mjs";
import * as Store from "chrome://browser/content/umbra-investigate/case-store.mjs";

const { UmbraInvestigate: Inv } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraInvestigate.sys.mjs");
const $ = id => document.getElementById(id);
const CASE_PREF = "umbra.investigate.lastCase";

export const ENGINES = {
  ahmia: q => `http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion/search/?q=${encodeURIComponent(q)}`,
  ddg: q => `https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/html/?q=${encodeURIComponent(q)}`,
  brave: q => `https://search.brave4u7jddbv7cyviptqjc7jusxh72uik7zt6adtckl5f4nwy2v72qd.onion/search?q=${encodeURIComponent(q)}`,
};

const ui = { current: null, leads: [] };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) e.append(k);
  return e;
}

function status(id, msg, cls = "") {
  const s = $(id);
  s.textContent = msg;
  s.className = "status " + cls;
}

function win() {
  return Services.wm.getMostRecentWindow("navigator:browser");
}

/** Most recently used onion tab other than this dashboard. */
export function targetBrowser() {
  const w = win();
  if (!w) return null;
  const self = window.browsingContext.top.embedderElement;
  const tabs = [...w.gBrowser.tabs].filter(t => t.linkedBrowser !== self &&
    /^https?$/.test(t.linkedBrowser.currentURI?.scheme) && Core.isOnionHost(t.linkedBrowser.currentURI.host));
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0]?.linkedBrowser ?? null;
}

function openTab(url) {
  if (!Core.guardDecision(url).allow) throw new Error("not an onion address");
  win().openTrustedLinkIn(url, "tab");
}

// ------------------------------------------------------------------ guard + traffic

function renderGuard() {
  const g = Inv.guardStatus();
  $("g-allowed").textContent = g.stats.allowed;
  $("g-blocked").textContent = g.stats.blocked;
  $("g-blackholed").textContent = g.stats.blackholed;
  const ok = g.installed && g.socks.type === 1 && g.socks.remoteDns;
  $("mode-pill").textContent = ok ? "Onion-only: on" : "Guard problem";
  $("mode-pill").className = "pill " + (ok ? "ok" : "bad");
  $("g-detail").textContent = `Layers: ${g.layers.join(" + ") || "none"} · Tor SOCKS ${g.socks.host}:${g.socks.port}` +
    ` · remote DNS ${g.socks.remoteDns ? "on" : "OFF"} · since ${new Date(g.since).toLocaleTimeString()}`;
  $("g-hosts").replaceChildren(...g.blockedHosts.map(([h, n]) => el("li", {}, `${h} × ${n}`)));
}

function renderTraffic() {
  const b = targetBrowser();
  const onlyTab = $("t-tab").checked;
  let rows = Inv.getLog(onlyTab && b ? { browserId: b.browserId } : {});
  if ($("t-blocked").checked) rows = rows.filter(r => r.blocked);
  rows = rows.slice(-200).reverse();
  $("traffic").tBodies[0].replaceChildren(...rows.map(r => {
    let path = r.url;
    try {
      const u = new URL(r.url);
      path = u.pathname + u.search;
    } catch (_) {}
    const st = r.blocked ? "blocked" : String(r.status ?? "…");
    return el("tr", { class: r.blocked ? "blocked" : "" },
      el("td", {}, new Date(r.started).toLocaleTimeString()), el("td", {}, r.method || ""),
      el("td", { title: r.blocked ? Core.explain(r.blocked) : "" }, st), el("td", { class: "mono" }, r.host || ""),
      el("td", { class: "mono path" }, path.slice(0, 160)));
  }));
}

function renderTarget() {
  const b = targetBrowser();
  $("target").textContent = b ? `${b.contentTitle || "(untitled)"} — ${b.currentURI.spec}` : "No onion tab open yet. Open an onion address or search above.";
  $("inspect").disabled = $("capture").disabled = !b;
}

// ------------------------------------------------------------------ inspection

function renderReport(report) {
  const box = $("report");
  const items = report.findings.map(f => el("li", { class: "finding " + f.kind },
    el("b", {}, f.title), el("p", {}, f.explanation),
    ...(f.evidence.length ? [el("ul", { class: "mono small" }, ...f.evidence.map(x => el("li", {}, String(x))))] : [])));
  box.replaceChildren(
    el("p", { class: "summary" }, items.length ? `${items.length} finding(s)` : "Nothing restrictive found: " + report.summary),
    el("ul", { class: "findings" }, ...items),
    el("p", { class: "meta" }, `${report.counts.forms} forms · ${report.counts.passwordFields} password fields · ` +
      `${report.counts.onionRefs} onion / ${report.counts.clearnetRefs} clearnet references`),
    el("p", { class: "meta" }, report.note));
}

export async function inspectTarget() {
  const b = targetBrowser();
  if (!b) throw new Error("no onion tab");
  const { report } = await Inv.inspect(b);
  renderReport(report);
  return report;
}

// ------------------------------------------------------------------ cases

async function refreshCases(selectId = null) {
  const cases = await Store.listCases();
  const sel = $("case-select");
  sel.replaceChildren(el("option", { value: "" }, cases.length ? "Choose a case…" : "No cases yet"),
    ...cases.map(c => el("option", { value: c.id }, (c.name || c.id) + (c.encrypted ? " (encrypted)" : ""))));
  const want = selectId ?? ui.current?.id ?? Services.prefs.getStringPref(CASE_PREF, "");
  if (want && cases.some(c => c.id === want)) sel.value = want;
  await selectCase(sel.value);
  return cases;
}

async function selectCase(id) {
  ui.current = null;
  $("case-detail").replaceChildren();
  if (!id) return;
  const list = await Store.listCases();
  const c = list.find(x => x.id === id);
  if (c?.encrypted) {
    $("case-detail").replaceChildren(el("p", { class: "meta" }, "Encrypted case. Enter the passphrase under “Encrypt case” and press Decrypt."),
      el("button", { onclick: () => decryptSelected() }, "Decrypt"));
    return;
  }
  ui.current = await Store.openCase(id);
  Services.prefs.setStringPref(CASE_PREF, id);
  renderCase();
}

function renderCase() {
  const c = ui.current;
  if (!c) return;
  const arts = c.manifest.artifacts;
  $("case-detail").replaceChildren(
    el("p", { class: "meta" }, `${c.info.name} · ${c.id} · created ${c.info.created} · ${arts.length} artifacts · ${c.log.length} log entries`),
    el("div", { class: "table-wrap" }, el("table", { class: "artifacts" },
      el("thead", {}, el("tr", {}, el("th", {}, "File"), el("th", {}, "SHA-256"), el("th", {}, "Bytes"))),
      el("tbody", {}, ...arts.slice(-60).reverse().map(a => el("tr", {},
        el("td", { class: "mono" }, a.path.replace("artifacts/", "")), el("td", { class: "mono hash", title: a.sha256 }, a.sha256.slice(0, 16) + "…"),
        el("td", {}, String(a.size))))))));
}

async function ensureCase() {
  if (ui.current) return ui.current;
  ui.current = await Store.createCase($("case-name").value || "Investigation " + new Date().toISOString().slice(0, 10), Inv.toolVersions());
  await refreshCases(ui.current.id);
  return ui.current;
}

export async function newCase(name) {
  ui.current = await Store.createCase(name || $("case-name").value, Inv.toolVersions());
  $("case-name").value = "";
  await refreshCases(ui.current.id);
  return ui.current;
}

export async function captureTarget(note = "") {
  const b = targetBrowser();
  if (!b) throw new Error("no onion tab");
  const c = await ensureCase();
  const r = await Store.capture(c, b, Inv, document, { note });
  renderReport(r.report);
  renderCase();
  return r;
}

async function decryptSelected() {
  const id = $("case-select").value;
  ui.current = await Store.decryptBundle(id, $("pass").value);
  $("pass").value = "";
  status("case-status", "Decrypted.", "ok");
  renderCase();
}

function guarded(fn, statusId = "case-status") {
  return async (...a) => {
    try {
      await fn(...a);
    } catch (e) {
      status(statusId, String(e.message || e), "bad");
      console.error(e);
    }
  };
}

// ------------------------------------------------------------------ leads

function renderLeads() {
  $("leads").replaceChildren(...ui.leads.slice(0, 500).map(l => el("li", {},
    el("button", { class: "link mono", onclick: () => openTab(l.url) }, l.url))));
}

export async function importLeads(text, source = "pasted") {
  const c = await ensureCase();
  const r = await Store.importLeads(c, text, source);
  ui.leads = r.leads;
  renderLeads();
  renderCase();
  status("case-status", `${r.leads.length} onion leads imported, ${r.ignored} non-onion entries ignored.`, "ok");
  return r;
}

// ------------------------------------------------------------------ wiring

function initInvestigate() {
  $("investigate").hidden = false;
  $("search").addEventListener("submit", e => {
    e.preventDefault();
    const q = $("q").value.trim();
    if (q) openTab(ENGINES[$("engine").value](q));
  });
  $("inspect").addEventListener("click", guarded(inspectTarget));
  $("capture").addEventListener("click", guarded(async () => {
    const r = await captureTarget();
    status("case-status", `Capture ${r.capture}: ${r.artifacts.length} artifacts hashed and logged.`, "ok");
  }));
  $("case-new").addEventListener("click", guarded(() => newCase()));
  $("case-select").addEventListener("change", guarded(e => selectCase(e.target.value)));
  $("case-verify").addEventListener("click", guarded(async () => {
    const c = await ensureCase();
    const v = await Store.verify(c);
    status("case-status", v.ok ? `Verified: ${v.artifacts} artifacts match their SHA-256, log chain of ${v.chain.count} entries intact.`
      : `INTEGRITY PROBLEM: ${JSON.stringify(v.problems.slice(0, 5))} chain=${v.chain.problem || "ok"}`, v.ok ? "ok" : "bad");
  }));
  $("case-export").addEventListener("click", guarded(async () => {
    const r = await Store.exportCase(await ensureCase());
    status("case-status", `Wrote ${r.hashdeep} and ${r.timesketch}.`, "ok");
  }));
  $("case-har").addEventListener("click", guarded(async () => {
    const c = await ensureCase();
    const n = c.manifest.artifacts.reduce((m, a) => Math.max(m, a.capture || 0), 0) + 1;
    const a = await Store.addArtifact(c, n, "traffic-all", "har", JSON.stringify(Inv.harFor(Inv.getLog()), null, 2), { url: null });
    renderCase();
    status("case-status", `Saved ${a.path} (${a.size} bytes).`, "ok");
  }));
  $("case-folder").addEventListener("click", guarded(async () => {
    const c = await ensureCase();
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(c.dir);
    f.reveal();
  }));
  $("note-add").addEventListener("click", guarded(async () => {
    const t = $("note").value.trim();
    if (!t) return;
    await Store.addNote(await ensureCase(), t);
    $("note").value = "";
    renderCase();
  }));
  $("encrypt").addEventListener("click", guarded(async () => {
    const bad = (await import("chrome://browser/content/umbra-vault/vault-crypto.mjs")).checkPassphrase($("pass").value);
    if (bad) throw new Error(bad);
    const r = await Store.encryptCase(await ensureCase(), $("pass").value, { removePlaintext: $("rm-plain").checked });
    $("pass").value = "";
    status("case-status", `Encrypted ${r.files} files into ${r.path}${r.removedPlaintext ? "; plaintext removed" : ""}.`, "ok");
    await refreshCases(ui.current?.id);
  }));
  $("leads-import").addEventListener("click", guarded(() => importLeads($("leads-in").value)));
  $("leads-file").addEventListener("change", guarded(async e => {
    const f = e.target.files[0];
    if (f) await importLeads(await f.text(), f.name);
  }));
  $("t-clear").addEventListener("click", () => {
    Inv.clearLog();
    renderTraffic();
    renderGuard();
  });
  const tick = () => {
    renderGuard();
    renderTarget();
    renderTraffic();
  };
  tick();
  setInterval(tick, 2000);
  refreshCases();
}

function initLauncher() {
  $("launcher").hidden = false;
  $("mode-pill").textContent = "Normal window";
  $("mode-pill").className = "pill";
  $("launch").addEventListener("click", guarded(async () => {
    const url = $("launch-url").value.trim() || null;
    await Inv.launch(url);
    status("launch-status", "Investigate window starting… It uses your current Tor connection.", "ok");
  }, "launch-status"));
}

if (Inv.isInvestigateMode()) initInvestigate();
else initLauncher();

window.UmbraInvestigateUI = { Inv, Store, Core, ENGINES, ui, targetBrowser, inspectTarget, captureTarget, newCase, importLeads, refreshCases };
