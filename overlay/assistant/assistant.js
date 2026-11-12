import { analyze } from "./assistant-logic.mjs";

const { UmbraAssistant } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraAssistant.sys.mjs");
const $ = id => document.getElementById(id);
const li = (t, cls) => {
  const e = document.createElement("li");
  e.textContent = t;
  if (cls) e.className = cls;
  return e;
};

function render(page) {
  if (!page) {
    $("status").textContent = "Open a web page, then choose Tools → Umbra Assistant.";
    return null;
  }
  if (page.error) {
    $("status").textContent = page.error;
    $("status").className = "status bad";
    return null;
  }
  const r = analyze(page);
  $("page").textContent = `${r.title || r.url} · computed locally, no network`;
  $("reading").textContent = `${r.reading.words.toLocaleString()} words · about ${r.reading.minutes} min read`;
  $("summary").replaceChildren(...r.summary.map(s => li(s)));
  $("s-summary").hidden = !r.summary.length;
  if (!r.summary.length) $("status").textContent = "There isn't enough text on this page to summarise.";
  $("terms").replaceChildren(...r.terms.map(t => {
    const s = document.createElement("span");
    s.textContent = t.term;
    const b = document.createElement("b");
    b.textContent = t.count;
    s.append(b);
    return s;
  }));
  $("s-terms").hidden = !r.terms.length;
  $("outline").replaceChildren(...r.outline.map(h => li(h.text, "l" + h.level)));
  $("s-outline").hidden = !r.outline.length;
  $("onions").replaceChildren(...r.onions.map(o => {
    const e = li("");
    const c = document.createElement("code");
    c.textContent = o;
    e.append(c);
    return e;
  }));
  $("s-onions").hidden = !r.onions.length;
  const ext = r.links.external.slice(0, 100);
  $("links").replaceChildren(...ext.map(l => li(`${l.text || "(no text)"} — ${l.href}`)));
  $("links-title").textContent = `External links · ${r.links.external.length} (plus ${r.links.internal} on the same site)`;
  $("s-links").hidden = !ext.length;
  $("copy").onclick = () => navigator.clipboard.writeText(`${r.title}\n${r.url}\n\n` + r.summary.map(s => "- " + s).join("\n"));
  return r;
}

window.UmbraAssistantPage = { result: render(UmbraAssistant.lastExtraction()), render };
