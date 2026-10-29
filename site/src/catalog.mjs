const CATEGORIES = new Set([
  "onion-services", "onion-knowledge", "privacy", "journalism",
  "whistleblower", "research", "digital-rights"
]);
const KINDS = new Set(["website", "directory", "onion"]);
const V3_HOST = /^[a-z2-7]{56}\.onion$/i;

export function isV3OnionUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username && !url.password && V3_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

export function isSafeWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username && !url.password && !url.hostname.endsWith(".onion");
  } catch {
    return false;
  }
}

export function validateCatalog(data) {
  if (!Array.isArray(data) || data.length === 0) throw new TypeError("Catalogue must be a non-empty array");
  const ids = new Set();
  for (const item of data) {
    if (!item || typeof item !== "object") throw new TypeError("Invalid catalogue record");
    for (const field of ["id", "title", "description", "category", "kind", "url", "operator", "verifiedBy", "checkedAt", "evidenceUrl"]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") throw new TypeError("Missing required catalogue field: " + field);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) throw new TypeError("Invalid record id: " + item.id);
    if (ids.has(item.id)) throw new TypeError("Duplicate record id: " + item.id);
    ids.add(item.id);
    if (!CATEGORIES.has(item.category)) throw new TypeError("Unrecognized category: " + item.category);
    if (!KINDS.has(item.kind)) throw new TypeError("Unrecognized resource kind: " + item.kind);
    if (item.kind === "onion" ? !isV3OnionUrl(item.url) : !isSafeWebUrl(item.url)) throw new TypeError("Unsafe or malformed destination in record: " + item.id);
    if (!isSafeWebUrl(item.evidenceUrl)) throw new TypeError("Evidence URL must be HTTPS: " + item.id);
    if (!/^20\d\d-\d\d-\d\d$/.test(item.checkedAt)) throw new TypeError("Invalid check date: " + item.id);
    if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== "string")) throw new TypeError("Tags must be an array of strings: " + item.id);
    if (item.kind === "onion" && !item.verifiedBy.trim()) throw new TypeError("Onion records require provenance: " + item.id);
  }
  return data;
}

export function filterResources(resources, query = "", category = "all") {
  const needle = query.trim().toLocaleLowerCase();
  return resources.filter(item => {
    if (category !== "all" && item.category !== category) return false;
    if (!needle) return true;
    const searchable = [item.title, item.description, item.category, item.kind, item.operator, item.verifiedBy, item.url, ...(item.tags || [])].join(" ").toLocaleLowerCase();
    return searchable.includes(needle);
  });
}
