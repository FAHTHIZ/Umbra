// Pure helpers for Umbra Desk (tested under Node).
export const MAX_NOTE_CHARS = 200000;

/** Group tabs [{url, title}] by site (eTLD-ish: last two labels; onions kept whole). */
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return u.protocol.replace(":", "");
    const h = u.hostname;
    if (h.endsWith(".onion")) return h.split(".").slice(-2).join(".");
    if (/^[\d.]+$/.test(h) || h.includes(":")) return h;
    return h.split(".").slice(-2).join(".");
  } catch (_) {
    return "other";
  }
}

export function groupTabs(tabs) {
  const groups = new Map();
  for (const t of tabs) {
    const s = siteOf(t.url);
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(t);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([site, items]) => ({ site, tabs: items }));
}

/** Markdown list of links, for pasting into notes or a document. */
export function linksMarkdown(tabs) {
  const esc = s => s.replace(/([\[\]\\])/g, "\\$1");
  return tabs.filter(t => /^https?:/.test(t.url)).map(t => `- [${esc(t.title || t.url)}](${t.url})`).join("\n");
}

export function clampNote(text) {
  return String(text ?? "").slice(0, MAX_NOTE_CHARS);
}
