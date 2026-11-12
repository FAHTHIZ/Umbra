import test from "node:test";
import assert from "node:assert/strict";
import { siteOf, groupTabs, linksMarkdown, clampNote, MAX_NOTE_CHARS } from "../../overlay/desk/desk-logic.mjs";

const onion = "a".repeat(56) + ".onion";

test("siteOf", () => {
  assert.equal(siteOf("https://news.example.com/x"), "example.com");
  assert.equal(siteOf(`http://www.${onion}/`), onion);
  assert.equal(siteOf("about:tor"), "about");
  assert.equal(siteOf("http://127.0.0.1:8000/"), "127.0.0.1");
  assert.equal(siteOf("not a url"), "other");
});

test("groupTabs sorts by size then name", () => {
  const g = groupTabs([{ url: "https://a.b.com/" }, { url: "https://z.org/" }, { url: "https://c.b.com/" }]);
  assert.deepEqual(g.map(x => [x.site, x.tabs.length]), [["b.com", 2], ["z.org", 1]]);
});

test("linksMarkdown escapes and skips non-web", () => {
  assert.equal(linksMarkdown([{ url: "https://x.org/", title: "a [b]" }, { url: "about:tor", title: "t" }]),
    "- [a \\[b\\]](https://x.org/)");
});

test("clampNote", () => {
  assert.equal(clampNote(null), "");
  assert.equal(clampNote("x".repeat(MAX_NOTE_CHARS + 5)).length, MAX_NOTE_CHARS);
});
