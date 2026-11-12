import test from "node:test";
import assert from "node:assert/strict";
import { splitSentences, summarize, keyTerms, onions, linkReport, readingMinutes, analyze } from "../../overlay/assistant/assistant-logic.mjs";

const article = `Tor protects people by routing traffic through three relays run by volunteers around the world.
The Tor network makes it hard for websites to learn where visitors connect from. Onion services keep both sides of a connection inside the Tor network.
Many news organisations run SecureDrop on onion services so sources can contact journalists. The weather was pleasant on Tuesday afternoon in the city.
Relays are operated by volunteers, and the network depends on their diversity. Onion services use addresses derived from their public keys.
Cats are popular pets in many households across several countries today.`;

test("sentences split and filtered", () => {
  const s = splitSentences(article);
  assert.ok(s.length >= 7);
  assert.ok(s.every(x => x.length >= 25));
});

test("summary is extractive, ordered and on-topic", () => {
  const sum = summarize(article, 3);
  assert.equal(sum.length, 3);
  const all = splitSentences(article);
  for (const s of sum) assert.ok(all.includes(s), "verbatim sentence");
  const idx = sum.map(s => all.indexOf(s));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
  assert.ok(!sum.some(s => s.startsWith("Cats")));
  assert.ok(sum.some(s => /onion services/i.test(s)));
});

test("key terms", () => {
  const t = keyTerms(article, 5).map(x => x.term);
  assert.ok(t.includes("tor") && t.includes("network"));
  assert.ok(!t.includes("the"));
});

test("onions and links", () => {
  const o = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion";
  assert.deepEqual(onions(`see ${o.toUpperCase()} and ${o}`), [o]);
  const r = linkReport([{ href: "https://x.org/a", text: "A" }, { href: "https://x.org/a" }, { href: "javascript:1" },
    { href: "https://site.example/p" }, { href: `http://${o}/`, text: "hidden" }], "https://site.example/");
  assert.equal(r.internal, 1);
  assert.equal(r.external.length, 2);
  assert.equal(r.onion.length, 1);
});

test("reading time and empty pages", () => {
  assert.deepEqual(readingMinutes(""), { words: 0, minutes: 1 });
  const r = analyze({ text: "", links: [], headings: [] });
  assert.deepEqual(r.summary, []);
});

test("non-latin text", () => {
  const ru = "Сеть Tor защищает пользователей от слежки в интернете каждый день. Луковые сервисы работают внутри сети Tor без выхода наружу. Сеть Tor поддерживают добровольцы по всему миру уже много лет.";
  assert.equal(splitSentences(ru).length, 3);
  assert.ok(keyTerms(ru).some(t => t.term === "сеть" || t.term === "tor"));
});
