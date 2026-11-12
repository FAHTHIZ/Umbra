// Pure helpers (unit-tested in tests/umbra/update-version.test.mjs).

/** Parse "v1.2.3", "1.2.3-alpha.1" -> {nums:[1,2,3], pre:"alpha.1"} or null. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v ?? "").trim());
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
}

/** SemVer precedence: >0 if a newer than b. Unparseable -> 0 (never "newer"). */
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

const RELEASES = "https://github.com/FAHTHIZ/Umbra/releases/tag/";

/**
 * Decide from a GitHub "latest release" JSON whether to notify.
 * Only tag_name is trusted; the link is always built from our fixed URL,
 * never taken from the response.
 */
export function evaluateRelease(json, current) {
  if (!json || typeof json !== "object" || json.draft || json.prerelease) return null;
  const tag = String(json.tag_name ?? "");
  if (!parseVersion(tag) || compareVersions(tag, current) <= 0) return null;
  return { version: tag.replace(/^v/, ""), url: RELEASES + encodeURIComponent(tag) };
}
