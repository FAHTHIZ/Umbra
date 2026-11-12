// Content-side actor: reads the page's visible text, headings and links. Read-only.
const MAX_TEXT = 400000;

export class UmbraAssistantChild extends JSWindowActorChild {
  receiveMessage(msg) {
    if (msg.name !== "UmbraAssistant:Extract") return null;
    const doc = this.document;
    // Prefer the main content area if one exists.
    const root = doc.querySelector("article, main, [role=main]") || doc.body;
    const text = (root?.innerText || "").slice(0, MAX_TEXT);
    const headings = [...doc.querySelectorAll("h1, h2, h3")].slice(0, 200)
      .map(h => ({ level: Number(h.tagName[1]), text: (h.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) }));
    const links = [...doc.querySelectorAll("a[href]")].slice(0, 2000)
      .map(a => ({ href: a.href, text: (a.textContent || "").replace(/\s+/g, " ").trim() }));
    return { url: doc.documentURI, title: doc.title, lang: doc.documentElement?.lang || "", text, headings, links };
  }
}
