// Umbra Vault file format v1: standard primitives only, via WebCrypto (NSS in Umbra, OpenSSL in Node).
//   key  = PBKDF2-HMAC-SHA-256(passphrase, 16-byte random salt, 600 000 iterations) -> AES-256 key
//   data = AES-256-GCM(key, 12-byte random IV, plaintext JSON, AAD = canonical header)
// The header (format, version, KDF and cipher parameters) is authenticated as AAD, so it can't
// be tampered with. No custom cryptography: this module only composes WebCrypto calls.
export const FORMAT = "umbra-vault";
export const VERSION = 1;
export const ITERATIONS = 600000; // OWASP 2023 recommendation for PBKDF2-HMAC-SHA256
export const MIN_PASSPHRASE = 12;

const te = new TextEncoder();
const td = new TextDecoder();

function subtle() {
  return globalThis.crypto.subtle;
}

export function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function headerAad(h) {
  // Fixed key order: canonical, independent of how the JSON file was formatted.
  return te.encode(JSON.stringify([h.format, h.version, h.kdf.name, h.kdf.hash, h.kdf.iterations, h.kdf.salt, h.cipher.name, h.cipher.iv]));
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await subtle().importKey("raw", te.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function checkPassphrase(p) {
  if (typeof p !== "string" || [...p.normalize("NFC")].length < MIN_PASSPHRASE) {
    return `Use a passphrase of at least ${MIN_PASSPHRASE} characters (several random words work well).`;
  }
  return null;
}

export async function encrypt(payload, passphrase, { iterations = ITERATIONS } = {}) {
  const bad = checkPassphrase(passphrase);
  if (bad) throw new Error(bad);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header = {
    format: FORMAT, version: VERSION,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
  };
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: headerAad(header), tagLength: 128 },
    key, te.encode(JSON.stringify(payload)));
  return JSON.stringify({ ...header, ciphertext: b64(new Uint8Array(ct)) });
}

export async function decrypt(fileText, passphrase) {
  let h;
  try {
    h = JSON.parse(fileText);
  } catch (_) {
    throw new Error("This isn't an Umbra Vault file.");
  }
  if (h?.format !== FORMAT) throw new Error("This isn't an Umbra Vault file.");
  if (h.version !== VERSION) throw new Error(`Unsupported Umbra Vault version ${h.version}.`);
  if (h.kdf?.name !== "PBKDF2" || h.kdf.hash !== "SHA-256" || h.cipher?.name !== "AES-GCM") {
    throw new Error("Unsupported Umbra Vault parameters.");
  }
  if (!Number.isInteger(h.kdf.iterations) || h.kdf.iterations < 100000 || h.kdf.iterations > 10000000) {
    throw new Error("Unsupported Umbra Vault parameters.");
  }
  const key = await deriveKey(passphrase, unb64(h.kdf.salt), h.kdf.iterations);
  let pt;
  try {
    pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(h.cipher.iv), additionalData: headerAad(h), tagLength: 128 },
      key, unb64(h.ciphertext));
  } catch (_) {
    throw new Error("Wrong passphrase, or the file was changed.");
  }
  return JSON.parse(td.decode(pt));
}

/** Bookmark tree (Places JSON) -> minimal portable tree: {title, url} | {title, children}. */
export function simplifyBookmarks(node) {
  if (node.uri) {
    return /^(https?|ftp):/i.test(node.uri) ? { title: node.title || "", url: node.uri } : null;
  }
  if (!node.children) return null;
  const children = node.children.map(simplifyBookmarks).filter(Boolean);
  return children.length ? { title: node.title || "", children } : null;
}

export function countBookmarks(tree) {
  if (!tree) return 0;
  if (tree.url) return 1;
  return (tree.children || []).reduce((n, c) => n + countBookmarks(c), 0);
}

/** Validate an imported payload before touching the profile. */
export function validatePayload(p) {
  if (!p || p.kind !== "umbra-vault-payload" || p.schema !== 1) throw new Error("Unexpected Vault contents.");
  const okNode = n => n && typeof n.title === "string" &&
    (typeof n.url === "string" ? /^(https?|ftp):\/\//i.test(n.url) : Array.isArray(n.children) && n.children.every(okNode));
  if (p.bookmarks !== null && !okNode(p.bookmarks)) throw new Error("Unexpected bookmark data.");
  if (!Array.isArray(p.logins) || !p.logins.every(l => typeof l.origin === "string" && typeof l.password === "string")) {
    throw new Error("Unexpected login data.");
  }
  return p;
}
