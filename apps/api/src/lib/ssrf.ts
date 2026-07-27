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

const isBlockedAiHostname = (hostname: string): boolean => {
  // URL.hostname keeps IPv6 in bracket-free form already; normalize just in case.
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
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
