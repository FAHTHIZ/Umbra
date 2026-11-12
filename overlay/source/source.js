// Umbra Source page (chrome). Directory data is bundled; nothing is fetched.
const { UmbraSource } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraSource.sys.mjs");

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function matches(entry, q) {
  if (!q) return true;
  const hay = [entry.title, entry.description, ...entry.countries, ...entry.languages, ...entry.topics].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function render(data, q) {
  const list = document.getElementById("list");
  list.replaceChildren();
  const shown = data.entries.filter(e => matches(e, q));
  for (const e of shown) {
    const card = el("article", "org");
    card.dataset.slug = e.slug;
    card.append(el("h3", null, e.title));
    if (e.description) card.append(el("p", null, e.description));
    const tags = [e.countries.slice(0, 3).join(", "), e.languages.slice(0, 3).join(", ")].filter(Boolean).join(" · ");
    if (tags) card.append(el("div", "tags", tags));
    card.append(el("code", null, e.onion));
    const b = el("button", null, "Open in Source mode");
    b.addEventListener("click", () => {
      try {
        UmbraSource.launch(`http://${e.onion}/`);
        b.textContent = "Opening in a separate window…";
      } catch (err) {
        b.textContent = "Couldn't open: " + err.message;
      }
    });
    card.append(b);
    list.append(card);
  }
  document.getElementById("count").textContent = `SecureDrop directory · ${shown.length} of ${data.entries.length}`;
}

const data = await (await fetch("chrome://browser/content/umbra-source/securedrop-directory.json")).json();
document.getElementById("attribution").textContent =
  `${data.attribution}. Snapshot ${data.generated}, bundled with Umbra; every address is checksum-verified at build time. ` +
  "Before submitting, check the address against the organisation's own website.";
render(data, "");
document.getElementById("filter").addEventListener("input", ev => render(data, ev.target.value.trim()));
window.UmbraSourcePage = { data };
