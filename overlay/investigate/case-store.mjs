// Umbra Investigate case store (runs in the privileged dashboard page).
//
// Layout of a case (inside the Investigate profile, never synced, permissions 0700/0600):
//   umbra-cases/<case-id>/
//     case.json            id, name, created, tool versions at creation
//     case-log.jsonl       hash-chained log, one JSON entry per line
//     manifest.json        every artifact: path, size, sha256, kind, url, captured
//     artifacts/NNNN-*.*   immutable evidence files (written once, never modified)
//     hashdeep.txt         HASHDEEP-1.0 manifest of artifacts/ (written by export)
//     timesketch.jsonl     timeline for Timesketch (written by export)
//   umbra-cases/<case-id>.umbracase   optional encrypted bundle (Umbra Vault format)
import * as Core from "chrome://browser/content/umbra-investigate/investigate-core.mjs";
import * as Vault from "chrome://browser/content/umbra-vault/vault-crypto.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const BUNDLE_FORMAT = "umbra-case-bundle";

export function casesRoot() {
  return PathUtils.join(Services.dirsvc.get("ProfD", Ci.nsIFile).path, "umbra-cases");
}

async function writePrivate(path, bytes) {
  await IOUtils.write(path, bytes, { mode: "create" });
  try {
    await IOUtils.setPermissions(path, 0o600);
  } catch (_) {}
}

async function writeReplace(path, text) {
  await IOUtils.writeUTF8(path, text, { tmpPath: path + ".tmp" });
  try {
    await IOUtils.setPermissions(path, 0o600);
  } catch (_) {}
}

async function mkdirPrivate(path) {
  await IOUtils.makeDirectory(path, { ignoreExisting: true, permissions: 0o700 });
}

function dirOf(id) {
  if (!/^case-\d{8}-\d{6}-[a-z2-9]{6}$/.test(id)) throw new Error("bad case id");
  return PathUtils.join(casesRoot(), id);
}

export async function listCases() {
  const root = casesRoot();
  if (!(await IOUtils.exists(root))) return [];
  const out = [];
  for (const p of await IOUtils.getChildren(root)) {
    const name = PathUtils.filename(p);
    if (/^case-.*\.umbracase$/.test(name)) {
      out.push({ id: name.replace(/\.umbracase$/, ""), encrypted: true, path: p });
      continue;
    }
    try {
      const info = await IOUtils.readJSON(PathUtils.join(p, "case.json"));
      out.push({ ...info, encrypted: false, path: p });
    } catch (_) {}
  }
  return out.sort((a, b) => String(b.created || b.id).localeCompare(String(a.created || a.id)));
}

async function readLog(dir) {
  const p = PathUtils.join(dir, "case-log.jsonl");
  if (!(await IOUtils.exists(p))) return [];
  return (await IOUtils.readUTF8(p)).split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export async function openCase(id) {
  const dir = dirOf(id);
  const info = await IOUtils.readJSON(PathUtils.join(dir, "case.json"));
  const log = await readLog(dir);
  let manifest = { artifacts: [] };
  try {
    manifest = await IOUtils.readJSON(PathUtils.join(dir, "manifest.json"));
  } catch (_) {}
  return { id, dir, info, log, manifest };
}

export async function append(c, type, data) {
  const e = await Core.chainEntry(c.log[c.log.length - 1] ?? null, type, data);
  // append-only: write the line, then keep it in memory
  const p = PathUtils.join(c.dir, "case-log.jsonl");
  await IOUtils.writeUTF8(p, JSON.stringify(e) + "\n", { mode: "appendOrCreate" });
  try {
    await IOUtils.setPermissions(p, 0o600);
  } catch (_) {}
  c.log.push(e);
  return e;
}

export async function createCase(name, versions) {
  await mkdirPrivate(casesRoot());
  const id = Core.newCaseId(new Date(), () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
  const dir = PathUtils.join(casesRoot(), id);
  await mkdirPrivate(dir);
  await mkdirPrivate(PathUtils.join(dir, "artifacts"));
  const info = { format: "umbra-case", schema: 1, id, name: Core.safeCaseName(name), created: new Date().toISOString(), versions };
  await writeReplace(PathUtils.join(dir, "case.json"), JSON.stringify(info, null, 2) + "\n");
  const c = { id, dir, info, log: [], manifest: { artifacts: [] } };
  await saveManifest(c);
  await append(c, "case-created", { name: info.name, versions });
  return c;
}

async function saveManifest(c) {
  c.manifest = { format: "umbra-case-manifest", schema: 1, case: c.id, updated: new Date().toISOString(), artifacts: c.manifest.artifacts };
  await writeReplace(PathUtils.join(c.dir, "manifest.json"), JSON.stringify(c.manifest, null, 2) + "\n");
}

function nextCapture(c) {
  return c.manifest.artifacts.reduce((n, a) => Math.max(n, a.capture || 0), 0) + 1;
}

/** Write one immutable artifact, hash it, log it. */
export async function addArtifact(c, capture, kind, ext, bytes, meta = {}) {
  const name = Core.artifactName(capture, kind, ext);
  const path = PathUtils.join(c.dir, "artifacts", name);
  const data = typeof bytes === "string" ? te.encode(bytes) : bytes;
  await writePrivate(path, data);
  const sha256 = await Core.sha256Hex(data);
  const a = { path: "artifacts/" + name, size: data.byteLength, sha256, kind, capture, captured: new Date().toISOString(), ...meta };
  c.manifest.artifacts.push(a);
  await saveManifest(c);
  await append(c, "artifact", { kind, path: a.path, sha256, size: a.size, url: meta.url ?? null });
  return a;
}

async function screenshot(browser, doc) {
  const wg = browser.browsingContext.currentWindowGlobal;
  const bmp = await wg.drawSnapshot(null, 1, "rgb(255,255,255)");
  const canvas = doc.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Capture evidence of the page in `browser`: DOM snapshot, screenshot, response headers,
 * structural inspection, HAR of this tab's traffic, and a capture record tying them together.
 */
export async function capture(c, browser, Inv, doc, { note = "" } = {}) {
  const n = nextCapture(c);
  const t0 = new Date().toISOString();
  const url = browser.currentURI.spec;
  if (!Core.guardDecision(url).allow || !/^https?:/.test(url)) throw new Error("Only onion pages can be captured.");
  const out = [];
  const dom = await Inv.serialize(browser);
  out.push(await addArtifact(c, n, "dom", "html", dom.html, { url: dom.url, title: dom.title, contentType: dom.contentType,
    note: "Serialized live DOM (after scripts ran), not the original response bytes." }));
  try {
    out.push(await addArtifact(c, n, "screenshot", "png", await screenshot(browser, doc), { url, note: "Visible viewport." }));
  } catch (e) {
    await append(c, "note", { text: `Screenshot failed: ${e}` });
  }
  const traffic = Inv.getLog({ browserId: browser.browserId });
  const top = [...traffic].reverse().find(r => r.topLevel && r.url === url && !r.blocked);
  out.push(await addArtifact(c, n, "headers", "json", JSON.stringify({ url, request: top?.requestHeaders ?? null,
    status: top?.status ?? null, statusText: top?.statusText ?? null, response: top?.responseHeaders ?? null,
    httpVersion: top?.httpVersion ?? null, note: "Cookie/Authorization values redacted." }, null, 2), { url }));
  const insp = await Inv.inspect(browser);
  const { text, ...structure } = insp.descriptor;
  out.push(await addArtifact(c, n, "inspection", "json", JSON.stringify({ report: insp.report, structure,
    textChars: text.length }, null, 2), { url }));
  out.push(await addArtifact(c, n, "traffic", "har", JSON.stringify(Inv.harFor(traffic), null, 2), { url,
    note: "This tab's request/response metadata since the log was last cleared." }));
  const record = {
    format: "umbra-capture", schema: 1, case: c.id, capture: n, url, title: dom.title,
    started: t0, finished: new Date().toISOString(), clock: "local system clock (UTC); not a trusted timestamp",
    versions: Inv.toolVersions(), guard: Inv.guardStatus(), note,
    artifacts: out.map(a => ({ path: a.path, sha256: a.sha256, size: a.size, kind: a.kind })),
  };
  out.push(await addArtifact(c, n, "capture", "json", JSON.stringify(record, null, 2), { url }));
  await append(c, "inspection", { url, kinds: insp.report.findings.map(f => f.kind) });
  return { capture: n, artifacts: out, report: insp.report };
}

export async function addNote(c, text) {
  return append(c, "note", { text: String(text).slice(0, 10000) });
}

export async function importLeads(c, text, source = "pasted") {
  const { leads, ignored } = Core.extractOnionLeads(text);
  const n = nextCapture(c);
  const a = await addArtifact(c, n, "leads", "json", JSON.stringify({ source, leads, ignored }, null, 2), { url: null });
  await append(c, "lead-import", { count: leads.length, ignored, path: a.path, source });
  return { leads, ignored, artifact: a };
}

/** Recompute every artifact hash and verify the log chain. */
export async function verify(c) {
  const problems = [];
  for (const a of c.manifest.artifacts) {
    const p = PathUtils.join(c.dir, ...a.path.split("/"));
    if (!(await IOUtils.exists(p))) {
      problems.push({ path: a.path, problem: "missing" });
      continue;
    }
    const h = await Core.sha256Hex(await IOUtils.read(p));
    if (h !== a.sha256) problems.push({ path: a.path, problem: "hash-mismatch" });
  }
  const chain = await Core.verifyChain(c.log);
  const logged = new Set(c.log.filter(e => e.type === "artifact").map(e => `${e.data.path}:${e.data.sha256}`));
  for (const a of c.manifest.artifacts) {
    if (!logged.has(`${a.path}:${a.sha256}`)) problems.push({ path: a.path, problem: "not-in-log" });
  }
  const listed = new Set(c.manifest.artifacts.map(a => a.path));
  const artDir = PathUtils.join(c.dir, "artifacts");
  if (await IOUtils.exists(artDir)) {
    for (const rel of Object.keys(await collectNames(artDir))) {
      const path = "artifacts/" + rel;
      if (!listed.has(path) && !path.endsWith(".tmp")) problems.push({ path, problem: "not-in-manifest" });
    }
  }
  return { ok: !problems.length && chain.ok, artifacts: c.manifest.artifacts.length, problems, chain };
}

/** hashdeep.txt + timesketch.jsonl (+ fresh manifest). */
export async function exportCase(c) {
  const files = c.manifest.artifacts.map(a => ({ path: "./" + a.path.replace(/^artifacts\//, ""), size: a.size, sha256: a.sha256 }));
  await writeReplace(PathUtils.join(c.dir, "hashdeep.txt"), Core.hashdeepManifest(files, {
    invokedFrom: "artifacts", command: "Umbra Investigate export (audit: cd artifacts && hashdeep -c sha256 -a -k ../hashdeep.txt -l -r .)" }));
  await append(c, "export", { what: "hashdeep.txt, timesketch.jsonl" });
  await writeReplace(PathUtils.join(c.dir, "timesketch.jsonl"), Core.timesketchJsonl({ id: c.id, name: c.info.name }, c.log));
  return { hashdeep: PathUtils.join(c.dir, "hashdeep.txt"), timesketch: PathUtils.join(c.dir, "timesketch.jsonl") };
}

function b64(bytes) {
  return Vault.b64(bytes);
}

async function collectNames(dir, base = dir, out = {}) {
  for (const p of await IOUtils.getChildren(dir)) {
    const st = await IOUtils.stat(p);
    const rel = p.slice(base.length + 1).split(/[\\/]/).join("/");
    if (st.type === "directory") await collectNames(p, base, out);
    else out[rel] = st.size;
  }
  return out;
}

async function collect(dir, base = dir, out = {}) {
  for (const p of await IOUtils.getChildren(dir)) {
    const st = await IOUtils.stat(p);
    const rel = p.slice(base.length + 1).split(/[\\/]/).join("/");
    if (st.type === "directory") await collect(p, base, out);
    else if (!rel.endsWith(".tmp")) out[rel] = b64(await IOUtils.read(p));
  }
  return out;
}

/**
 * Encrypt the whole case into <id>.umbracase (PBKDF2-SHA256 600k + AES-256-GCM, Umbra Vault v1).
 * With removePlaintext, the bundle is decrypted and compared first; only then is the folder deleted.
 */
export async function encryptCase(c, passphrase, { removePlaintext = false, iterations } = {}) {
  const files = await collect(c.dir);
  const payload = { kind: BUNDLE_FORMAT, schema: 1, id: c.id, created: new Date().toISOString(), files };
  const text = await Vault.encrypt(payload, passphrase, iterations ? { iterations } : {});
  const out = PathUtils.join(casesRoot(), c.id + ".umbracase");
  await writeReplace(out, text);
  const back = await Vault.decrypt(await IOUtils.readUTF8(out), passphrase);
  const same = back.id === c.id && Object.keys(files).length === Object.keys(back.files).length &&
    Object.entries(files).every(([k, v]) => back.files[k] === v);
  if (!same) throw new Error("Encrypted bundle did not verify; plaintext kept.");
  if (removePlaintext) await IOUtils.remove(c.dir, { recursive: true });
  return { path: out, files: Object.keys(files).length, removedPlaintext: removePlaintext };
}

export async function decryptBundle(id, passphrase) {
  const p = PathUtils.join(casesRoot(), id + ".umbracase");
  const payload = await Vault.decrypt(await IOUtils.readUTF8(p), passphrase);
  if (payload?.kind !== BUNDLE_FORMAT || payload.id !== id) throw new Error("Not an Umbra case bundle.");
  const dir = dirOf(id);
  if (await IOUtils.exists(dir)) throw new Error("A plaintext copy of this case already exists.");
  await mkdirPrivate(dir);
  for (const [rel, data] of Object.entries(payload.files)) {
    if (rel.split("/").some(s => s === ".." || s === "" || s.startsWith("."))) throw new Error("unsafe path in bundle: " + rel);
    const parts = rel.split("/");
    if (parts.length > 1) await mkdirPrivate(PathUtils.join(dir, ...parts.slice(0, -1)));
    await writePrivate(PathUtils.join(dir, ...parts), Vault.unb64(data));
  }
  return openCase(id);
}

export { td };
