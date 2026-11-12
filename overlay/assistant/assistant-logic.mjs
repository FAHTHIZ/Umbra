// Umbra Assistant analysis: deterministic, local, no model and no network.
// Extractive summarisation (term-frequency sentence scoring), outline, key terms, links.
const STOP = new Set(("a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its " +
  "just more most my no not of on or our out so than that the their them then there these they this those to too up us was we were what " +
  "when where which while who why will with would you your also about after all any because before being both each few further here " +
  "him himself itself me only other over own same she should some such through under until very again against between during off once " +
  "said says one two new like get got").split(" "));

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
export const ONION_RE = /\b[a-z2-7]{56}\.onion\b/gi;

export function words(text) {
  return (text.toLowerCase().match(WORD) || []).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

export function splitSentences(text) {
  const out = [];
  for (const para of text.split(/\n{1,}/)) {
    const p = para.replace(/\s+/g, " ").trim();
    if (!p) continue;
    // Split after . ! ? (and CJK 。！？) followed by space/quote + capital/digit, or CJK punctuation.
    const parts = p.split(/(?<=[.!?])\s+(?=["“'(\[]?[\p{Lu}\p{N}])|(?<=[。！？])/u);
    for (const s of parts) {
      const t = s.trim();
      if (t.length >= 25 && t.length <= 600 && (t.match(WORD) || []).length >= 5) out.push(t);
    }
  }
  return out;
}

export function keyTerms(text, n = 10) {
  const tf = new Map();
  for (const w of words(text)) tf.set(w, (tf.get(w) || 0) + 1);
  return [...tf.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w, c]) => ({ term: w, count: c }));
}

/** Top-n sentences by normalised term frequency, returned in document order. */
export function summarize(text, n = 5) {
  const sents = splitSentences(text);
  if (sents.length <= n) return sents;
  const tf = new Map();
  for (const w of words(text)) tf.set(w, (tf.get(w) || 0) + 1);
  const max = Math.max(1, ...tf.values());
  const seen = new Set();
  const scored = sents.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((a, w) => a + (tf.get(w) || 0) / max, 0) / Math.sqrt(Math.max(ws.length, 1));
    const pos = i < 3 ? 0.15 : 0; // leads often carry the gist
    return { s, i, score: score + pos };
  });
  const picked = [];
  for (const x of scored.sort((a, b) => b.score - a.score || a.i - b.i)) {
    const key = x.s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(x);
    if (picked.length === n) break;
  }
  return picked.sort((a, b) => a.i - b.i).map(x => x.s);
}

export function readingMinutes(text) {
  const n = (text.match(WORD) || []).length;
  return { words: n, minutes: Math.max(1, Math.round(n / 230)) };
}

export function onions(text) {
  return [...new Set((text.match(ONION_RE) || []).map(s => s.toLowerCase()))];
}

/** Links: keep http(s) only, dedupe, group external vs same-site. */
export function linkReport(links, pageUrl) {
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch (_) {}
  const seen = new Set();
  const out = { internal: 0, external: [], onion: [] };
  for (const l of links) {
    let u;
    try {
      u = new URL(l.href);
    } catch (_) {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) continue;
    seen.add(u.href);
    if (u.hostname.endsWith(".onion")) out.onion.push({ href: u.href, text: (l.text || "").trim().slice(0, 120) });
    if (u.hostname === host) out.internal++;
    else out.external.push({ href: u.href, text: (l.text || "").trim().slice(0, 120) });
  }
  return out;
}

export function analyze(page) {
  const text = page.text || "";
  return {
    title: page.title || "",
    url: page.url || "",
    lang: page.lang || "",
    reading: readingMinutes(text),
    summary: summarize(text, 5),
    terms: keyTerms(text, 12),
    outline: (page.headings || []).filter(h => h.text.trim()).slice(0, 60),
    onions: onions(text + " " + (page.links || []).map(l => l.href).join(" ")),
    links: linkReport(page.links || [], page.url),
  };
}
