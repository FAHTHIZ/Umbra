import { encrypt, decrypt, checkPassphrase, simplifyBookmarks, countBookmarks, validatePayload } from "./vault-crypto.mjs";

const { UmbraVault } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraVault.sys.mjs");
const $ = id => document.getElementById(id);

function status(id, text, cls = "") {
  $(id).textContent = text;
  $(id).className = "status " + cls;
}

/** Build and encrypt. Exposed for tests (which skip the file picker). */
async function buildExport(pass, opts) {
  const p = await UmbraVault.collect(opts);
  if (p.bookmarksRaw) {
    p.bookmarks = simplifyBookmarks(p.bookmarksRaw);
    delete p.bookmarksRaw;
  }
  return { text: await encrypt(p, pass), bookmarks: countBookmarks(p.bookmarks), logins: p.logins.length };
}

async function importText(text, pass) {
  const payload = validatePayload(await decrypt(text, pass));
  return UmbraVault.restore(payload);
}

$("export").addEventListener("click", async () => {
  const pass = $("x-pass").value;
  const bad = checkPassphrase(pass);
  if (bad) return status("x-status", bad, "bad");
  if (pass !== $("x-pass2").value) return status("x-status", "The passphrases don't match.", "bad");
  try {
    status("x-status", "Encrypting…");
    const r = await buildExport(pass, { bookmarks: $("x-bookmarks").checked, logins: $("x-logins").checked });
    const path = await UmbraVault.pickSave(window.browsingContext.topChromeWindow);
    if (!path) return status("x-status", "Cancelled.");
    await UmbraVault.writeFile(path, r.text);
    $("x-pass").value = $("x-pass2").value = "";
    status("x-status", `Saved ${r.bookmarks} bookmarks and ${r.logins} logins to ${path}`, "ok");
  } catch (e) {
    status("x-status", "Export failed: " + e.message, "bad");
  }
});

$("import").addEventListener("click", async () => {
  const pass = $("i-pass").value;
  if (!pass) return status("i-status", "Enter the file's passphrase first.", "bad");
  try {
    const path = await UmbraVault.pickOpen(window.browsingContext.topChromeWindow);
    if (!path) return status("i-status", "Cancelled.");
    status("i-status", "Decrypting…");
    const r = await importText(await UmbraVault.readFile(path), pass);
    $("i-pass").value = "";
    const skipped = r.loginsSkipped ? ` ${r.loginsSkipped} logins weren't imported because this profile doesn't store logins.` : "";
    status("i-status", `Imported ${r.bookmarks} bookmarks and ${r.logins} new logins.${skipped}`, "ok");
  } catch (e) {
    status("i-status", "Import failed: " + e.message, "bad");
  }
});

if (!UmbraVault.loginsAvailable()) {
  $("x-logins").checked = false;
  $("x-logins").disabled = true;
  $("logins-note").hidden = false;
}

window.UmbraVaultPage = { buildExport, importText };
