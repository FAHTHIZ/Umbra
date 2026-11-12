import { groupTabs, linksMarkdown, clampNote, MAX_NOTE_CHARS } from "./desk-logic.mjs";

const { UmbraDesk } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraDesk.sys.mjs");
const $ = id => document.getElementById(id);
const notes = $("notes");

function count() {
  $("note-count").textContent = `${notes.value.length.toLocaleString()} / ${MAX_NOTE_CHARS.toLocaleString()} characters · memory only`;
}

notes.maxLength = MAX_NOTE_CHARS;
notes.value = UmbraDesk.getNotes();
count();
notes.addEventListener("input", () => {
  UmbraDesk.setNotes(clampNote(notes.value));
  count();
});
// Keep several Desk tabs in sync.
const off = UmbraDesk.onNotes(v => {
  if (v !== notes.value) {
    notes.value = v;
    count();
  }
});
window.addEventListener("unload", off);

function renderTabs() {
  const tabs = UmbraDesk.openTabs();
  const box = $("tabs");
  box.replaceChildren();
  for (const g of groupTabs(tabs)) {
    const h = document.createElement("div");
    h.className = "site";
    h.textContent = g.site + " ";
    const n = document.createElement("span");
    n.textContent = `(${g.tabs.length})`;
    h.append(n);
    box.append(h);
    for (const t of g.tabs) {
      const d = document.createElement("div");
      d.className = "tab";
      d.textContent = t.title || t.url;
      d.title = t.url;
      box.append(d);
    }
  }
  $("tabs-title").textContent = `Open tabs · ${tabs.length}`;
  return tabs;
}

$("refresh").addEventListener("click", renderTabs);
$("links-to-notes").addEventListener("click", () => {
  const md = linksMarkdown(UmbraDesk.openTabs());
  if (!md) return;
  notes.value = clampNote((notes.value ? notes.value.replace(/\n*$/, "\n\n") : "") + md + "\n");
  UmbraDesk.setNotes(notes.value);
  count();
});
$("copy-notes").addEventListener("click", () => navigator.clipboard.writeText(notes.value));
$("clear-notes").addEventListener("click", () => {
  notes.value = "";
  UmbraDesk.clearNotes();
  count();
});
$("forget").addEventListener("click", () => UmbraDesk.closeAndForget(window.browsingContext.topChromeWindow));
renderTabs();
window.UmbraDeskPage = { renderTabs };
