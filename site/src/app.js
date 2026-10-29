import { filterResources, isV3OnionUrl, validateCatalog } from "./catalog.mjs";

const $ = id => document.getElementById(id);
const viewNames = {
  home: "Overview", discover: "Explore directory", onion: "Onion services",
  "public-interest": "Public interest", bookmarks: "Bookmarks", security: "Privacy center"
};
let catalogue = [];
let currentView = "home";
let currentQuery = "";
let categoryFilter = "all";
let sortOrder = "recommended";
let bookmarks = readBookmarks();
let modalResource = null;
let toastTimer = null;
let torBrowserStatus = { configured: false, message: "Tor Browser is not configured." };

function isDesktopApp() {
  return Boolean(window.__TAURI__?.core?.invoke);
}
function invokeNative(command, args = {}) {
  if (!isDesktopApp()) return Promise.reject(new Error("Native desktop features are unavailable in the web preview."));
  return window.__TAURI__.core.invoke(command, args);
}
function normalizeOnionAddress(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : "http://" + trimmed;
  return isV3OnionUrl(candidate) ? new URL(candidate).href : null;
}
function updateTorStatusChip() {
  const chip = $("tor-status-chip");
  if (!chip) return;
  if (!isDesktopApp()) {
    chip.textContent = "MANUAL TOR HANDOFF";
    chip.title = "The web preview does not control a Tor connection.";
    return;
  }
  chip.textContent = torBrowserStatus.configured ? "TOR BROWSER READY" : "TOR BROWSER NOT SET";
  chip.classList.toggle("is-ready", torBrowserStatus.configured);
  chip.title = torBrowserStatus.message;
}
async function refreshTorBrowserStatus() {
  if (!isDesktopApp()) return;
  try {
    torBrowserStatus = await invokeNative("get_tor_browser_status");
  } catch {
    torBrowserStatus = { configured: false, message: "Could not inspect Tor Browser configuration." };
  }
  updateTorStatusChip();
}

function readBookmarks() {
  try {
    const stored = JSON.parse(localStorage.getItem("umbrella.bookmarks.v1") || "[]");
    return Array.isArray(stored) ? stored.filter(value => typeof value === "string") : [];
  } catch { return []; }
}
function writeBookmarks() {
  try { localStorage.setItem("umbrella.bookmarks.v1", JSON.stringify(bookmarks)); return true; }
  catch { showToast("Browser storage is unavailable. Bookmark was not saved."); return false; }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function categoryLabel(category) {
  return ({
    "onion-services": "Onion services", "onion-knowledge": "Onion learning",
    privacy: "Privacy & security", journalism: "Journalism", whistleblower: "Source protection",
    research: "Research", "digital-rights": "Digital rights"
  })[category] || category;
}
function kindLabel(resource) {
  if (resource.kind === "onion") return "ONION SERVICE";
  if (resource.kind === "directory") return "DIRECTORY";
  return "PUBLIC WEBSITE";
}
function kindGlyph(resource) {
  if (resource.kind === "onion") return "◎";
  if (resource.category === "journalism" || resource.category === "whistleblower") return "§";
  if (resource.category === "research") return "⌘";
  if (resource.category === "privacy" || resource.category === "digital-rights") return "◇";
  return "↗";
}
function sortedResources(resources) {
  const output = [...resources];
  if (sortOrder === "alphabetical") output.sort((a, b) => a.title.localeCompare(b.title));
  else if (sortOrder === "checked") output.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt) || a.title.localeCompare(b.title));
  else output.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || a.title.localeCompare(b.title));
  return output;
}
function resourceCard(resource) {
  const saved = bookmarks.includes(resource.id);
  const onion = resource.kind === "onion";
  const tags = resource.tags.map(tag => '<span class="tag">' + escapeHtml(tag) + "</span>").join("");
  const caution = resource.caution ? '<p class="card-caution"><span aria-hidden="true">!</span> ' + escapeHtml(resource.caution) + "</p>" : "";
  const action = onion
    ? '<button class="button button-primary button-small" type="button" data-action="open-resource" data-id="' + escapeHtml(resource.id) + '">Open with Tor Browser <span aria-hidden="true">↗</span></button>'
    : '<button class="button button-primary button-small" type="button" data-action="open-resource" data-id="' + escapeHtml(resource.id) + '">Open source <span aria-hidden="true">↗</span></button>';
  return '<article class="resource-card"><div class="card-top"><span class="resource-glyph ' + (onion ? "glyph-onion" : "") + '" aria-hidden="true">' + kindGlyph(resource) + '</span><span class="kind-label ' + (onion ? "kind-onion" : "") + '">' + kindLabel(resource) + '</span>'
    + '<button class="save-button ' + (saved ? "is-saved" : "") + '" type="button" data-action="bookmark" data-id="' + escapeHtml(resource.id) + '" aria-pressed="' + String(saved) + '" aria-label="' + (saved ? "Remove bookmark for " : "Bookmark ") + escapeHtml(resource.title) + '">' + (saved ? "★" : "☆") + "</button></div>"
    + "<h3>" + escapeHtml(resource.title) + "</h3><p class=\"resource-description\">" + escapeHtml(resource.description) + "</p>"
    + '<div class="tag-row">' + tags + "</div>" + caution
    + '<div class="source-meta"><span>Listed by ' + escapeHtml(resource.operator) + '</span><a href="' + escapeHtml(resource.evidenceUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Provenance ↗</a></div>'
    + '<div class="card-bottom"><span class="category-label">' + escapeHtml(categoryLabel(resource.category)) + '</span><span class="check-date">Checked ' + escapeHtml(resource.checkedAt) + "</span></div>"
    + '<div class="card-actions">' + action + '<button class="button button-quiet button-small" type="button" data-action="details" data-id="' + escapeHtml(resource.id) + '">Details</button></div></article>';
}
function cardGrid(resources) {
  if (!resources.length) return '<div class="empty-state"><span class="empty-icon">⌕</span><h3>No matching sources</h3><p>Try a broader term or clear the local search and filters. Nothing was sent to a search provider.</p><button class="button button-secondary" type="button" data-action="clear-filters">Clear filters</button></div>';
  return '<div class="resource-grid">' + resources.map(resourceCard).join("") + "</div>";
}
function sectionHeading(kicker, title, description, count) {
  return '<div class="section-heading"><div><span class="eyebrow">' + escapeHtml(kicker) + '</span><h1>' + escapeHtml(title) + "</h1><p>" + escapeHtml(description) + "</p></div>"
    + (count == null ? "" : '<span class="result-count">' + count + (count === 1 ? " SOURCE" : " SOURCES") + "</span>") + "</div>";
}
function homeView() {
  const onionCount = catalogue.filter(item => item.kind === "onion").length;
  const categoryCount = new Set(catalogue.map(item => item.category)).size;
  const featured = sortedResources(catalogue.filter(item => item.featured)).slice(0, 3);
  return '<section class="hero-panel"><div class="hero-copy"><span class="eyebrow"><span class="tiny-dot"></span> A QUIETER WAY TO EXPLORE</span>'
    + '<h1>The directory,<br><em>not the data trail.</em></h1><p>Explore public-interest resources and operator-published onion services. Search and recommendations stay on this device; no account or interest profile is needed.</p>'
    + '<div class="hero-actions"><button class="button button-primary" data-action="navigate" data-view="discover">Explore directory <span aria-hidden="true">→</span></button><button class="button button-secondary" data-action="navigate" data-view="onion">Browse onion services</button></div>'
    + '<div class="hero-footnote"><span class="status-dot"></span> Local catalogue · No analytics · No remote search API</div></div>'
    + '<div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="hero-orb"><img src="./assets/umbrella.svg" alt=""></div><span class="orbit-node node-one"></span><span class="orbit-node node-two"></span><span class="orbit-node node-three"></span><div class="hero-art-label">DISCOVER<br><strong>ON YOUR TERMS</strong></div></div></section>'
    + '<section class="stats-row"><div class="stat-card"><span class="stat-mark mark-mint">◎</span><div><strong>' + onionCount + '</strong><span>Operator-listed onion services</span></div></div>'
    + '<div class="stat-card"><span class="stat-mark mark-blue">↗</span><div><strong>' + catalogue.length + '</strong><span>Curated resources</span></div></div>'
    + '<div class="stat-card"><span class="stat-mark mark-gold">◇</span><div><strong>' + categoryCount + '</strong><span>Explore categories</span></div></div>'
    + '<div class="stat-card"><span class="stat-mark mark-muted">0</span><div><strong>None</strong><span>Search analytics collected</span></div></div></section>'
    + '<div class="home-section-head"><div><span class="eyebrow">START HERE</span><h2>Trusted starting points</h2><p>Primary sources and public-interest research tools to help you explore safely.</p></div><button class="text-button" data-action="navigate" data-view="discover">View directory <span aria-hidden="true">→</span></button></div>'
    + cardGrid(featured)
    + '<section class="notice-panel"><span class="notice-icon">i</span><div><strong>' + (isDesktopApp() ? "Umbrella hands navigation to your installed Tor Browser." : "This web preview is a directory, not a Tor browser.") + '</strong><p>' + (isDesktopApp() ? "Onion and public HTTPS addresses open in the Tor Browser you configure. If it cannot be launched, Umbrella does not fall back to an ordinary browser. Check the onion-service indicator before entering sensitive information." : "Copy an onion address and paste it into the official Tor Browser. This page does not create a Tor circuit or provide anonymity.") + '</p></div><button data-action="navigate" data-view="security" class="text-button">Privacy settings →</button></section>';
}
function categoryOptions() {
  const categories = [...new Set(catalogue.map(item => item.category))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
  return '<option value="all">All categories</option>' + categories.map(category => '<option value="' + escapeHtml(category) + '"' + (categoryFilter === category ? " selected" : "") + ">" + escapeHtml(categoryLabel(category)) + "</option>").join("");
}
function listingView() {
  let records = filterResources(catalogue, currentQuery, categoryFilter);
  if (currentView === "onion") records = records.filter(item => item.kind === "onion");
  if (currentView === "public-interest") records = records.filter(item => ["journalism", "whistleblower", "research", "digital-rights"].includes(item.category));
  if (currentView === "bookmarks") records = records.filter(item => bookmarks.includes(item.id));
  records = sortedResources(records);
  const title = currentView === "onion" ? "Onion services" : currentView === "public-interest" ? "Public-interest research" : currentView === "bookmarks" ? "Your bookmarks" : "Explore the directory";
  const description = currentView === "onion"
    ? "Addresses published by operators or in official documentation. Copy an address and open it manually in Tor Browser."
    : currentView === "public-interest"
      ? "Journalism, research, digital-rights and source-protection resources. Verify each organization through its own official channels."
      : currentView === "bookmarks"
        ? "Saved IDs live in this browser profile's localStorage. They are not encrypted and are not synced to an account."
        : "Browse the bundled catalogue or filter it locally. Search terms are not transmitted or stored by Umbrella.";
  let html = sectionHeading(currentView === "onion" ? "TOR NETWORK RESOURCES" : "LOCAL CATALOGUE", title, description, records.length);
  if (currentView !== "bookmarks") {
    html += '<div class="filter-bar"><label class="select-label">Category<select id="category-filter">' + categoryOptions() + '</select></label><label class="select-label">Sort by<select id="sort-order"><option value="recommended"' + (sortOrder === "recommended" ? " selected" : "") + '>Featured first</option><option value="alphabetical"' + (sortOrder === "alphabetical" ? " selected" : "") + '>A to Z</option><option value="checked"' + (sortOrder === "checked" ? " selected" : "") + '>Check date</option></select></label><button class="text-button filter-reset" data-action="clear-filters">Reset filters</button></div>';
  } else if (records.length) {
    html += '<div class="bookmarks-note"><span aria-hidden="true">◇</span> Bookmarks are local and not encrypted. Avoid saving sources here on a shared or untrusted device.</div><div class="bookmarks-toolbar"><button class="button button-quiet button-small" data-action="clear-bookmarks">Clear all bookmarks</button></div>';
  }
  return html + cardGrid(records);
}
function securityView() {
  const torSetup = isDesktopApp()
    ? '<article class="security-card ' + (torBrowserStatus.configured ? "security-good" : "security-warning") + '"><span class="security-icon">' + (torBrowserStatus.configured ? "✓" : "!") + '</span><span class="eyebrow">NATIVE BROWSER HANDOFF</span><h2>' + (torBrowserStatus.configured ? "Tor Browser configured" : "Connect your Tor Browser") + '</h2><p>' + escapeHtml(torBrowserStatus.message) + ' Umbrella launches that browser with the address; it does not embed web pages or create a VPN.</p><button class="button button-primary" type="button" data-action="configure-tor">Choose Tor Browser folder</button></article>'
    : '<article class="security-card security-warning"><span class="security-icon">!</span><span class="eyebrow">WEB PREVIEW</span><h2>Manual Tor Browser handoff</h2><p>The web preview cannot launch or verify a browser installed on your computer. Copy onion addresses and open them in official Tor Browser.</p><a class="inline-link" href="https://www.torproject.org/download/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Get Tor Browser from the official site ↗</a></article>';
  return sectionHeading("PRIVACY CENTER", "Know the boundaries.", "Clear security claims are better than promises nobody can verify.", null)
    + '<div class="security-grid">' + torSetup
    + '<article class="security-card security-good"><span class="security-icon">✓</span><span class="eyebrow">IMPLEMENTED IN THIS PROTOTYPE</span><h2>Local catalogue search</h2><p>Filtering runs in this page against the bundled JSON file. The query is not sent to an external search provider or saved by Umbrella.</p></article>'
    + '<article class="security-card security-good"><span class="security-icon">✓</span><span class="eyebrow">IMPLEMENTED IN THIS PROTOTYPE</span><h2>No accounts or analytics</h2><p>No Umbrella login, tracking SDK, ad network, remote font, third-party script or backend search service is included.</p></article>'
    + '<article class="security-card security-warning"><span class="security-icon">!</span><span class="eyebrow">IMPORTANT LIMITATION</span><h2>Tor is not a VPN</h2><p>The desktop app asks your separately installed Tor Browser to open the URL. It does not run a Tor daemon, create circuits, or verify that a page loaded successfully. The browser remains responsible for its own network protections.</p></article>'
    + '<article class="security-card security-warning"><span class="security-icon">!</span><span class="eyebrow">IMPORTANT LIMITATION</span><h2>Bookmarks are not encrypted</h2><p>Bookmark IDs are stored in localStorage. Other people or software with access to the same browser profile may be able to see them. Do not store sensitive case data here.</p></article>'
    + '<article class="security-card"><span class="security-icon">↗</span><span class="eyebrow">TRUSTED FOUNDATIONS</span><h2>Keep Tor Browser unmodified</h2><p>Umbrella does not embed a generic webview for onion pages. The native app launches your separately installed Tor Browser so its own privacy controls remain in charge.</p><a class="inline-link" href="https://www.torproject.org/download/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Official Tor Browser downloads ↗</a></article>'
    + '<article class="security-card"><span class="security-icon">i</span><span class="eyebrow">DIRECTORY QUALITY</span><h2>Listed does not mean safe</h2><p>Provenance means a record was found in a named operator source. It does not guarantee the service is online, benign, uncompromised or appropriate for every researcher.</p><a class="inline-link" href="https://support.torproject.org/about-tor/onion-services/what-is-a-dot-onion/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Learn how onion services work ↗</a></article>'
    + '</div><section class="security-next"><h2>What must happen before a hardened browser</h2><ol><li>Preserve and maintain the official Tor Browser privacy model.</li><li>Test native handoff on each supported operating system.</li><li>Check no-direct-fallback behavior and address validation.</li><li>Threat-model downloads, case storage, device compromise and updates.</li><li>Complete independent security review before high-risk journalistic use.</li></ol></section>';
}

function render() {
  $("breadcrumb-current").textContent = viewNames[currentView] || "Overview";
  document.querySelectorAll("[data-view].nav-item").forEach(button => {
    const active = button.dataset.view === currentView;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("onion-count").textContent = String(catalogue.filter(item => item.kind === "onion").length);
  $("bookmark-count").textContent = String(bookmarks.length);
  $("view-root").setAttribute("aria-busy", "false");
  if (currentView === "home") $("view-root").innerHTML = homeView();
  else if (currentView === "security") $("view-root").innerHTML = securityView();
  else $("view-root").innerHTML = listingView();
}
function navigate(view) {
  if (!viewNames[view]) return;
  currentView = view;
  categoryFilter = "all";
  if (view === "home" || view === "security") currentQuery = "";
  $("local-search").value = currentQuery;
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
}
function showToast(message) {
  const region = $("toast-region");
  region.textContent = message;
  region.classList.add("toast-visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.classList.remove("toast-visible"), 3200);
}
function showOnionModal(resource) {
  modalResource = resource;
  $("modal-root").innerHTML = '<div class="modal-scrim" data-action="dismiss-modal"><section class="address-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description">'
    + '<button class="modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button><span class="modal-symbol">◎</span><span class="eyebrow">ONION ADDRESS</span><h2 id="modal-title">' + escapeHtml(resource.title) + '</h2>'
    + '<p id="modal-description">This page cannot launch or route a connection through Tor. Copy the address and paste it into the official Tor Browser yourself.</p>'
    + '<label class="address-label" for="onion-address">Published address</label><input id="onion-address" class="address-input" readonly value="' + escapeHtml(resource.url) + '" spellcheck="false">'
    + '<div class="address-provenance"><span class="status-dot"></span><span>Listed by ' + escapeHtml(resource.operator) + '<small>Last checked in this catalogue: ' + escapeHtml(resource.checkedAt) + '</small></span></div>'
    + '<div class="modal-actions"><button type="button" class="button button-primary" data-action="copy-modal-address">Copy address</button><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button></div>'
    + '<p class="modal-footnote">Listing is not a guarantee of availability or safety. Verify high-risk destinations independently before sharing sensitive information.</p></section></div>';
  $("onion-address").focus();
  $("onion-address").select();
}
function showDetails(resource) {
  if (resource.kind === "onion") { showOnionModal(resource); return; }
  $("modal-root").innerHTML = '<div class="modal-scrim" data-action="dismiss-modal"><section class="address-modal details-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button>'
    + '<span class="eyebrow">SOURCE DETAILS</span><h2 id="modal-title">' + escapeHtml(resource.title) + '</h2><p>' + escapeHtml(resource.description) + '</p>'
    + '<dl class="details-list"><dt>Category</dt><dd>' + escapeHtml(categoryLabel(resource.category)) + '</dd><dt>Publisher / operator</dt><dd>' + escapeHtml(resource.operator) + '</dd><dt>Provenance</dt><dd>' + escapeHtml(resource.verifiedBy) + '</dd><dt>Checked in catalogue</dt><dd>' + escapeHtml(resource.checkedAt) + '</dd><dt>Address</dt><dd class="break-anywhere">' + escapeHtml(resource.url) + '</dd></dl>'
    + (resource.caution ? '<div class="modal-caution">' + escapeHtml(resource.caution) + '</div>' : "")
    + '<div class="modal-actions"><a class="button button-primary" href="' + escapeHtml(resource.evidenceUrl) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">View provenance ↗</a><button type="button" class="button button-secondary" data-action="close-modal">Close</button></div></section></div>';
}
function closeModal() { $("modal-root").innerHTML = ""; modalResource = null; }

async function configureTorBrowser() {
  if (!isDesktopApp()) {
    showToast("Install the desktop app to configure a Tor Browser handoff.");
    return;
  }
  try {
    const result = await invokeNative("configure_tor_browser");
    torBrowserStatus = result;
    updateTorStatusChip();
    render();
    if (result.configured) showToast("Tor Browser folder saved. Check the browser's own status before sensitive work.");
    else if (!result.cancelled) showToast(result.message || "Tor Browser was not configured.");
  } catch (error) {
    showToast(String(error || "Could not configure Tor Browser."));
  }
}

async function openInTorBrowser(address, title = "Onion address") {
  const raw = String(address || "").trim();
  const onionAddress = normalizeOnionAddress(raw);
  const mentionsOnion = raw.toLowerCase().includes(".onion");
  if (mentionsOnion && !onionAddress) {
    showToast("Invalid onion address. A v3 hostname needs 56 letters a–z or digits 2–7 before .onion.");
    return;
  }
  let target = onionAddress;
  if (!target) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        showToast("Only public HTTPS sources and valid v3 onion addresses can be opened.");
        return;
      }
      target = parsed.href;
    } catch {
      showToast("Enter a public HTTPS URL or a valid v3 .onion address.");
      return;
    }
  }

  if (isDesktopApp()) {
    try {
      if (!torBrowserStatus.configured) {
        const setup = await invokeNative("configure_tor_browser");
        torBrowserStatus = setup;
        updateTorStatusChip();
        render();
        if (!setup.configured) {
          showToast(setup.message || "Tor Browser was not configured. No connection was made.");
          return;
        }
      }
      await invokeNative("open_in_tor_browser", { address: target });
      showToast("Address passed to Tor Browser. Check its connection indicator before continuing.");
    } catch (error) {
      showToast(String(error || "Tor Browser could not be started. No fallback browser was used."));
      await refreshTorBrowserStatus();
    }
    return;
  }

  if (onionAddress) {
    showOnionModal({
      title,
      url: target,
      operator: "Address entered by user; not verified by Umbrella",
      verifiedBy: "Not checked",
      checkedAt: "Not verified",
      caution: "Use the official Tor Browser. This web preview cannot route traffic through Tor."
    });
    return;
  }
  window.open(target, "_blank", "noopener,noreferrer");
}

async function copyOnionAddress() {
  if (!modalResource || !isV3OnionUrl(modalResource.url)) { showToast("This address did not pass the onion address check."); return; }
  try {
    await navigator.clipboard.writeText(modalResource.url);
    showToast("Address copied. Paste it into the official Tor Browser.");
    closeModal();
  } catch {
    $("onion-address").focus();
    $("onion-address").select();
    showToast("Clipboard permission was unavailable. The address is selected; copy it manually.");
  }
}
function toggleBookmark(id) {
  const exists = bookmarks.includes(id);
  const previous = bookmarks;
  bookmarks = exists ? bookmarks.filter(value => value !== id) : [...bookmarks, id];
  if (!writeBookmarks()) { bookmarks = previous; return; }
  render();
  showToast(exists ? "Removed from local bookmarks." : "Saved in this browser profile.");
}

document.addEventListener("click", event => {
  const externalLink = event.target.closest('a[target="_blank"]');
  if (externalLink && isDesktopApp()) {
    event.preventDefault();
    openInTorBrowser(externalLink.href, externalLink.textContent.trim() || "External source");
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "navigate") navigate(button.dataset.view);
  else if (action === "bookmark") toggleBookmark(button.dataset.id);
  else if (action === "open-resource") {
    const resource = catalogue.find(item => item.id === button.dataset.id);
    if (resource) openInTorBrowser(resource.url, resource.title);
  } else if (action === "configure-tor") {
    configureTorBrowser();
  } else if (action === "copy-onion") {
    const resource = catalogue.find(item => item.id === button.dataset.id);
    if (resource && resource.kind === "onion") showOnionModal(resource);
  } else if (action === "details") {
    const resource = catalogue.find(item => item.id === button.dataset.id);
    if (resource) showDetails(resource);
  } else if (action === "close-modal" || (action === "dismiss-modal" && event.target === button)) closeModal();
  else if (action === "copy-modal-address") copyOnionAddress();
  else if (action === "reload") window.location.reload();
  else if (action === "clear-filters") {
    currentQuery = ""; categoryFilter = "all"; sortOrder = "recommended"; $("local-search").value = ""; render();
  } else if (action === "clear-bookmarks") {
    if (window.confirm("Remove all Umbrella bookmarks saved in this browser profile?")) {
      bookmarks = []; writeBookmarks(); render(); showToast("Local bookmarks cleared.");
    }
  }
});
$("local-search").addEventListener("input", event => {
  currentQuery = event.target.value;
  if (currentView === "home" || currentView === "security") currentView = "discover";
  render();
});
$("local-search").addEventListener("keydown", event => {
  if (event.key === "Escape") { event.target.value = ""; currentQuery = ""; render(); }
  if (event.key === "Enter") {
    const entered = event.target.value.trim();
    if (entered.toLowerCase().includes(".onion")) {
      const address = normalizeOnionAddress(entered);
      if (!address) {
        showToast("Invalid onion address. A v3 hostname needs 56 letters a–z or digits 2–7 before .onion.");
        return;
      }
      openInTorBrowser(address, "Address bar");
      return;
    }
    currentView = "discover";
    render();
    $("view-root").focus();
  }
});
$("view-root").addEventListener("change", event => {
  if (event.target.id === "category-filter") { categoryFilter = event.target.value; render(); }
  else if (event.target.id === "sort-order") { sortOrder = event.target.value; render(); }
});
document.addEventListener("keydown", event => { if (event.key === "Escape" && modalResource) closeModal(); });

async function start() {
  updateTorStatusChip();
  await refreshTorBrowserStatus();
  try {
    const response = await fetch("./data/catalog.json", { cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error("Catalogue request failed");
    catalogue = validateCatalog(await response.json());
    render();
  } catch {
    $("view-root").setAttribute("aria-busy", "false");
    $("view-root").innerHTML = '<section class="error-panel"><span class="security-icon">!</span><h1>Catalogue unavailable</h1><p>The bundled catalogue could not be loaded or failed validation. The app will not substitute an untrusted remote directory.</p><button class="button button-secondary" data-action="reload">Try again</button></section>';
  }
}
start();
