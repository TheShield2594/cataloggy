// Guards for outbound fetches whose target URL is user-configurable.
//
// The AI provider endpoint is deliberately allowed to point at a LAN or
// localhost LLM server (Ollama, LM Studio, a self-hosted vLLM, etc.), so —
// unlike the web-push endpoint, which only ever talks to public browser push
// services and blocks all private ranges — we cannot simply reject private
// IPs here. Instead we block what is *never* a legitimate LLM host but *is* a
// classic SSRF target: non-HTTP schemes, the cloud-metadata / link-local
// range, and the unspecified address. Combined with disabling redirect
// following at the fetch call sites, this stops a stolen API token from
// turning the AI feature into a metadata-service / internal-probe proxy while
// preserving local-model setups.

// Canonicalize an IPv4-mapped IPv6 literal (e.g. "::ffff:a9fe:a9fe", the form
// Node normalizes "[::ffff:169.254.169.254]" into) to its dotted-quad IPv4
// address, so the IPv4 blocklist rules below can't be bypassed by expressing a
// blocked address in IPv6 mapped notation.
const normalizeHostname = (hostname: string): string => {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  const mapped = host.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return host;

  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
};

const isBlockedAiHostname = (hostname: string): boolean => {
  const host = normalizeHostname(hostname);
  return (
    host === "0.0.0.0" ||
    host === "::" ||
    /^169\.254\./.test(host) || // IPv4 link-local, incl. 169.254.169.254 (cloud metadata)
    /^fe80:/.test(host) || // IPv6 link-local
    host === "fd00:ec2::254" // AWS IMDS over IPv6
  );
};

/**
 * Validates a user-supplied AI-provider URL. Returns the parsed URL when it is
 * an acceptable outbound target, or null when it must be rejected.
 */
export const validateAiProviderUrl = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isBlockedAiHostname(url.hostname)) return null;
  return url;
};
