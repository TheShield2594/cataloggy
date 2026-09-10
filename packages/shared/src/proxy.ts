export const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`))
    .map((prefix) => (prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix));

  return parsed.length > 0 ? parsed : [...fallback];
};

/**
 * `url` with `prefix` removed, or null when the prefix doesn't apply.
 *
 * What comes after the prefix has to be a boundary, not just any character, or
 * a prefix of `/api` would also claim `/apiary`. The boundaries are the three a
 * request target can actually have: nothing at all (`/api`), a path separator
 * (`/api/health`), or the start of the query or fragment (`/api?debug=1`).
 *
 * That last case is the one worth stating: it used to be rejected, because the
 * check was a bare `startsWith(prefix + "/")` and `/api?x=1` has no slash after
 * the prefix. The URL was then passed through unmodified, so it reached routing
 * as `/api?x=1` and 404'd — a bare-prefix request with a query string was the
 * one shape a proxy mount didn't normalize.
 */
export const stripProxyPrefix = (url: string, prefix: string) => {
  if (!url.startsWith(prefix)) {
    return null;
  }

  const rest = url.slice(prefix.length);

  if (rest === "") return "/";
  if (rest.startsWith("/")) return rest;
  if (rest.startsWith("?") || rest.startsWith("#")) return `/${rest}`;

  return null;
};

export const normalizeProxyPath = (rawUrl: string, prefixes: readonly string[]) => {
  for (const prefix of prefixes) {
    const stripped = stripProxyPrefix(rawUrl, prefix);
    // Against null, not falsiness: "/" is the correct answer for a bare prefix
    // and would fail a truthiness check on the day someone returns "" instead.
    if (stripped !== null) {
      return stripped;
    }
  }

  return rawUrl;
};

// Only trust X-Forwarded-* headers from explicitly configured proxies, so
// request.ip (used as the rate-limit key) can't be spoofed by clients when
// there's no reverse proxy in front of this service.
export const parseTrustProxy = (raw: string | undefined): boolean | string[] | undefined => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean);
};
