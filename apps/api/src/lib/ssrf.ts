// Guards for outbound fetches whose target URL is user-configurable.
//
// Two sinks live behind these helpers, with deliberately different policies:
//
//   * The AI provider endpoint may point at a LAN or localhost LLM server
//     (Ollama, LM Studio, a self-hosted vLLM, etc.), so we cannot simply
//     reject private IPs. Instead we block what is *never* a legitimate LLM
//     host but *is* a classic SSRF target: non-HTTP schemes, the
//     cloud-metadata / link-local range, and the unspecified address.
//   * The web-push endpoint only ever talks to public browser push services,
//     so it blocks every private range as well.
//
// Combined with disabling redirect following at the fetch call sites, this
// stops a stolen API token from turning either feature into a
// metadata-service / internal-probe proxy while preserving local-model setups.
//
// A hostname is only half the story: `169.254.169.254.nip.io` and
// `localtest.me` are ordinary public names that resolve to blocked addresses,
// and an attacker who controls a domain can point an A record anywhere. So the
// async validators below also resolve the hostname and apply the same rules to
// every address the request could actually connect to.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Canonicalize an IPv4-mapped IPv6 literal (e.g. "::ffff:a9fe:a9fe", the form
// Node normalizes "[::ffff:169.254.169.254]" into, or the dotted-quad form
// dns.lookup can hand back) to its dotted-quad IPv4 address, so the IPv4
// blocklist rules below can't be bypassed by expressing a blocked address in
// IPv6 mapped notation.
const normalizeHostname = (hostname: string): string => {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  const dotted = host.match(/^::ffff:(?:0:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];

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

const isBlockedPushHostname = (hostname: string): boolean => {
  const host = normalizeHostname(hostname);
  return (
    isBlockedAiHostname(host) ||
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host) // IPv6 unique-local (fc00::/7)
  );
};

/** Every address a connection to `hostname` could land on. */
export type HostResolver = (hostname: string) => Promise<string[]>;

const dnsResolver: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

// Applies `isBlocked` to the addresses the hostname resolves to. IP literals
// are returned as-is: the caller has already run them through `isBlocked`, and
// handing one to a DNS lookup buys nothing.
//
// A resolution failure is treated as "not allowed" rather than "allowed" — the
// request could not have succeeded anyway, so failing closed costs nothing and
// keeps a resolver that errors out from becoming a way past the check.
//
// This closes the static-DNS bypass, not DNS rebinding: fetch resolves the name
// again when it connects, so a resolver that answers differently on the second
// lookup can still slip through. Pinning the connection to a validated address
// would need a custom dispatcher; until then the redirect:"error" at the call
// sites keeps the far cheaper redirect-based pivot closed.
const hostnameResolvesSafely = async (
  hostname: string,
  isBlocked: (host: string) => boolean,
  resolveHost: HostResolver
): Promise<boolean> => {
  const host = normalizeHostname(hostname);
  if (isIP(host)) return true;

  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return false;
  }

  return addresses.length > 0 && !addresses.some(isBlocked);
};

/**
 * Validates the *syntax* of a user-supplied AI-provider URL. Returns the parsed
 * URL when its scheme and literal hostname are acceptable, or null when it must
 * be rejected. Use this for save-time validation; `resolveAiProviderUrl` is the
 * check to run immediately before an outbound request.
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

/**
 * `validateAiProviderUrl` plus a DNS check on the hostname. Returns the parsed
 * URL only when neither the literal host nor any address it resolves to is a
 * blocked outbound target.
 */
export const resolveAiProviderUrl = async (
  raw: string,
  resolveHost: HostResolver = dnsResolver
): Promise<URL | null> => {
  const url = validateAiProviderUrl(raw);
  if (!url) return null;
  return (await hostnameResolvesSafely(url.hostname, isBlockedAiHostname, resolveHost)) ? url : null;
};

/**
 * Validates the syntax of a browser push-service endpoint: https only, and no
 * literal private/loopback/link-local host.
 */
export const validatePushEndpoint = (raw: string): URL | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (isBlockedPushHostname(url.hostname)) return null;
  return url;
};

/**
 * `validatePushEndpoint` plus a DNS check, so a public name pointing at a
 * private address can't be stored as a subscription and replayed by the
 * notification job.
 */
export const resolvePushEndpoint = async (
  raw: string,
  resolveHost: HostResolver = dnsResolver
): Promise<URL | null> => {
  const url = validatePushEndpoint(raw);
  if (!url) return null;
  return (await hostnameResolvesSafely(url.hostname, isBlockedPushHostname, resolveHost)) ? url : null;
};
