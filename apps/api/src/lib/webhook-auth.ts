import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET?.trim();

const WEBHOOK_ALLOWED_IPS = (process.env.WEBHOOK_ALLOWED_IPS ?? "")
  .split(",")
  .map((ip) => ip.trim())
  .filter(Boolean);

// Strips the IPv4-mapped IPv6 prefix (e.g. "::ffff:192.168.1.5") so plain
// IPv4 addresses in WEBHOOK_ALLOWED_IPS match requests proxied through it.
const normalizeIp = (ip: string): string => ip.replace(/^::ffff:/, "");

export const isAllowedWebhookIp = (request: FastifyRequest): boolean => {
  if (WEBHOOK_ALLOWED_IPS.length === 0) return true;
  return WEBHOOK_ALLOWED_IPS.includes(normalizeIp(request.ip));
};

// Fastify doesn't validate query/header types against a route's TS generics at
// runtime, so a repeated parameter ("?token=a&token=b", or a duplicated header)
// arrives here as a string[] despite the declared type. Guard explicitly rather
// than let Buffer.from() coerce an array into a buffer of zeroes.
const asSecretCandidate = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

let warnedAboutQuerySecret = false;

export const verifyWebhookSecret = (request: FastifyRequest): boolean => {
  if (!WEBHOOK_SECRET) return false;
  if (!isAllowedWebhookIp(request)) return false;

  // Header first. A secret in the query string is logged by every hop that
  // records a URL — this API redacts its own copy, but a reverse proxy's access
  // log is outside our reach — so senders that can set headers should, and the
  // header form is what wins when both are present. Plex can't set headers on
  // its webhooks at all, which is why the query form has to stay supported.
  const header = asSecretCandidate(request.headers["x-webhook-secret"]);
  const provided = header ?? asSecretCandidate((request.query as Record<string, unknown>).token);
  if (!provided) return false;

  // Compare byte lengths, not string lengths: a secret with any non-ASCII
  // character encodes to more bytes than it has characters, and timingSafeEqual
  // throws on mismatched buffers — which would turn a wrong secret into a 500.
  const candidate = Buffer.from(provided);
  const expected = Buffer.from(WEBHOOK_SECRET);
  if (candidate.length !== expected.length) return false;
  if (!timingSafeEqual(candidate, expected)) return false;

  // Said once per process, not per request: a scrobbling media server would
  // otherwise repeat this line all evening.
  if (!header && !warnedAboutQuerySecret) {
    warnedAboutQuerySecret = true;
    request.log.warn(
      "Webhook authenticated with WEBHOOK_SECRET in the query string, which reverse-proxy access logs record in plaintext. Send it as the x-webhook-secret header instead if your media server supports custom headers (Jellyfin does; Plex does not)."
    );
  }

  return true;
};
