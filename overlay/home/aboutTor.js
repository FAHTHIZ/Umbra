"use strict";
// Umbra home. Runs as a privileged-origin local page with a strict CSP:
// no inline script, no remote resources, no network requests of its own.

const UMBRA_PROVIDERS = [
  { id: "onionsearch", name: "OnionSearch", url: "https://onionsearch.io/search", param: "q", note: "Default. Onion-service discovery. Queries travel over Tor." },
  { id: "ddg-onion", name: "DuckDuckGo (.onion)", url: "https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/", param: "q", note: "DuckDuckGo via its onion service." },
  { id: "brave-onion", name: "Brave Search (.onion)", url: "https://search.brave4u7jddbv7cyviptqjc7jusxh72uik7zt6adtckl5f4nwy2v72qd.onion/search", param: "q", note: "Brave Search via its onion service." },
  { id: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/", param: "q", note: "" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search", param: "q", note: "" },
  { id: "startpage", name: "Startpage", url: "https://www.startpage.com/sp/search", param: "q", note: "" },
  { id: "ecosia", name: "Ecosia", url: "https://www.ecosia.org/search", param: "q", note: "" },
  { id: "google", name: "Google", url: "https://www.google.com/search", param: "q", note: "Google often shows CAPTCHAs to Tor users." },
  { id: "mojeek", name: "Mojeek", url: "https://www.mojeek.com/search", param: "q", note: "" },
];
const STORE_KEY = "umbra.home.provider";

function loadProvider() {
  try { return localStorage.getItem(STORE_KEY) || "onionsearch"; } catch (e) { return "onionsearch"; }
}
function saveProvider(id) {
  try { localStorage.setItem(STORE_KEY, id); } catch (e) { /* storage unavailable: keep default */ }
}

function applyProvider(form, input, note, id) {
  const p = UMBRA_PROVIDERS.find(x => x.id === id) || UMBRA_PROVIDERS[0];
  form.action = p.url;
  input.name = p.param;
  note.textContent = p.note || ("Searching with " + p.name + ". Every provider is reached through Tor.");
  return p;
}

function setStatus(kind, text) {
  const el = document.getElementById("status");
  el.className = "status status-" + kind;
  document.getElementById("status-text").textContent = text;
}

function renderExplore() {
  const grid = document.getElementById("explore-grid");
  const data = window.UMBRA_EXPLORE || { categories: [] };
  for (const cat of data.categories) {
    const h = document.createElement("div");
    h.className = "cat";
    h.textContent = cat.name;
    grid.append(h);
    for (const item of cat.items) {
      const a = document.createElement("a");
      a.className = "onion";
      a.href = item.url;
      a.rel = "noreferrer";
      a.textContent = item.title;
      const s = document.createElement("small");
      s.textContent = new URL(item.url).host;
      a.append(s);
      grid.append(a);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const select = document.getElementById("provider");
  const note = document.getElementById("provider-note");
  for (const p of UMBRA_PROVIDERS) {
    const o = document.createElement("option");
    o.value = p.id; o.textContent = p.name;
    select.append(o);
  }
  select.value = loadProvider();
  applyProvider(form, input, note, select.value);
  select.addEventListener("change", () => {
    applyProvider(form, input, note, select.value);
    saveProvider(select.value);
    input.focus();
  });
  form.addEventListener("submit", e => {
    if (!input.value.trim()) { e.preventDefault(); input.focus(); }
  });
  renderExplore();
});

// The parent actor (unchanged upstream AboutTorParent) sends InitialData.
window.addEventListener("InitialData", event => {
  const d = event.detail || {};
  if (d.torConnectEnabled === false) {
    setStatus("warn", "Tor is managed outside Umbra (system Tor or custom setup)");
  } else {
    setStatus("ok", "Protected: traffic is routed through Tor");
  }
});
// Upstream may send this; Umbra shows no fundraising banners but must not error.
window.addEventListener("DismissYEC", () => {});
