export const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`))
    .map((prefix) => (prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix));

  return parsed.length > 0 ? parsed : [...fallback];
};

export const stripProxyPrefix = (url: string, prefix: string) => {
  if (url === prefix) {
    return "/";
  }

  if (!url.startsWith(`${prefix}/`)) {
    return null;
  }

  return url.slice(prefix.length) || "/";
};

export const normalizeProxyPath = (rawUrl: string, prefixes: readonly string[]) => {
  for (const prefix of prefixes) {
    const stripped = stripProxyPrefix(rawUrl, prefix);
    if (stripped) {
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
