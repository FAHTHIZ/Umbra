// Read-only content actor for Umbra Investigate. It reads page *structure* only:
// form actions, methods and field types/names, never field values. It does not
// click, fill, submit or fetch anything, and it makes no network requests.
import { guardDecision } from "resource:///modules/umbra/investigate-core.mjs";

const MAX_TEXT = 200000;
const MAX_FORMS = 50;
const MAX_FIELDS = 100;
const PAY_SCHEMES = /^(bitcoin|monero|ethereum|lightning|litecoin|zcash):/i;
const CAPTCHA_SEL = "[class*=captcha i],[id*=captcha i],[name*=captcha i],img[alt*=captcha i],img[src*=captcha i]," +
  ".g-recaptcha,.h-captcha,.cf-turnstile,iframe[src*=captcha i],iframe[src*=challenge i]";

function labelOf(el) {
  try {
    const l = el.labels?.[0]?.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
    return l.trim().replace(/\s+/g, " ").slice(0, 80);
  } catch (_) {
    return "";
  }
}

function field(el) {
  return {
    tag: el.localName,
    type: (el.type || el.localName || "").toLowerCase(),
    name: (el.name || "").slice(0, 80),
    id: (el.id || "").slice(0, 80),
    autocomplete: (el.getAttribute?.("autocomplete") || "").slice(0, 40),
    required: !!el.required,
    label: labelOf(el),
  };
}

export class UmbraInvestigateChild extends JSWindowActorChild {
  receiveMessage(msg) {
    const doc = this.document;
    if (msg.name === "Inspect") return this.inspect(doc);
    if (msg.name === "Serialize") return this.serialize(doc);
    return null;
  }

  inspect(doc) {
    const forms = [...doc.forms].slice(0, MAX_FORMS).map(f => {
      const els = [...f.elements].slice(0, MAX_FIELDS);
      const submit = els.filter(e => e.type === "submit" || e.localName === "button")
        .map(e => (e.value && e.type === "submit" ? e.value : e.textContent || "").trim()).join(" ").slice(0, 120);
      return {
        action: f.getAttribute("action") ? f.action : "",
        method: (f.method || "get").toLowerCase(),
        submitText: submit,
        fields: els.filter(e => e.localName !== "fieldset").map(field),
      };
    });
    // password inputs outside any <form>
    const loose = [...doc.querySelectorAll("input[type=password]")].filter(e => !e.form);
    if (loose.length) forms.push({ action: "", method: "", submitText: "", fields: loose.slice(0, MAX_FIELDS).map(field) });

    let onionRefs = 0;
    let clearnetRefs = 0;
    const paymentLinks = new Set();
    for (const el of [...doc.querySelectorAll("a[href],img[src],script[src],link[href],iframe[src],form[action]")].slice(0, 5000)) {
      const raw = el.href || el.src || el.action;
      if (typeof raw !== "string" || !raw) continue;
      const m = PAY_SCHEMES.exec(raw);
      if (m) {
        paymentLinks.add(m[1].toLowerCase());
        continue;
      }
      if (!/^(https?|wss?):/i.test(raw)) continue;
      guardDecision(raw).allow ? onionRefs++ : clearnetRefs++;
    }
    const capEls = doc.querySelectorAll(CAPTCHA_SEL);
    const hints = [...capEls].slice(0, 10).map(e => e.localName + (e.id ? "#" + e.id : "") +
      (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : ""));
    let metaRefresh = null;
    const meta = doc.querySelector("meta[http-equiv=refresh i]");
    if (meta) {
      const mm = /url\s*=\s*['"]?([^'";]+)/i.exec(meta.getAttribute("content") || "");
      if (mm) {
        try {
          metaRefresh = new URL(mm[1].trim(), doc.baseURI).href;
        } catch (_) {
          metaRefresh = mm[1].trim();
        }
      }
    }
    let httpStatus = null;
    try {
      httpStatus = this.contentWindow.performance.getEntriesByType("navigation")[0]?.responseStatus ?? null;
    } catch (_) {}
    return {
      url: doc.documentURI,
      title: doc.title.slice(0, 300),
      httpStatus,
      forms,
      iframes: [...doc.querySelectorAll("iframe[src]")].slice(0, 50).map(f => f.src),
      captcha: { elements: capEls.length, hints },
      text: (doc.body?.innerText || "").slice(0, MAX_TEXT),
      paymentLinks: [...paymentLinks],
      metaRefresh,
      onionRefs,
      clearnetRefs,
      contentType: doc.contentType,
    };
  }

  serialize(doc) {
    const dt = doc.doctype;
    const doctype = dt ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ""}${dt.systemId ? ` "${dt.systemId}"` : ""}>\n` : "";
    return {
      url: doc.documentURI,
      title: doc.title,
      contentType: doc.contentType,
      characterSet: doc.characterSet,
      lastModified: doc.lastModified,
      referrer: doc.referrer,
      html: doctype + (doc.documentElement?.outerHTML ?? ""),
    };
  }
}
