// Fastify's request logging includes the full URL, query string and all, and a
// reverse proxy in front of it writes the same line to its own access log. Any
// credential that travels as a query parameter therefore ends up in plaintext
// in two places that outlive the request.
//
// The webhook secret is the one that has no way around it: Plex cannot attach
// custom headers to its outgoing webhooks, so `?token=<WEBHOOK_SECRET>` is the
// only form it can send. Redacting on the way into the log is what keeps that
// out of the API's own logs — the proxy's copy is outside our reach, which is
// why the README steers senders that *can* set headers to `x-webhook-secret`.
//
// The addon has the same exposure from the other end: every "Mark Watched"
// click is a `GET /mark-watched/…?token=<capability>`. It lives here rather
// than in either service so both loggers can share one list of parameters to
// mask.

const SENSITIVE_QUERY_PARAMS = new Set([
  "token",
  "secret",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "password",
  "pin",
]);

const REDACTED = "REDACTED";

const redactPair = (pair: string): string => {
  const eq = pair.indexOf("=");
  // No `=` means no value to leak — a bare `?token` says nothing on its own.
  if (eq === -1) return pair;
  const key = pair.slice(0, eq);
  if (!SENSITIVE_QUERY_PARAMS.has(decodeKey(key).toLowerCase())) return pair;
  return `${key}=${REDACTED}`;
};

// Keys are rarely percent-encoded, but a sender that encodes one shouldn't be
// able to slip a secret past the match by writing `%74oken`.
const decodeKey = (key: string): string => {
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    // Malformed escapes (a lone `%`) throw; the raw key is the best guess left.
    return key;
  }
};

/**
 * Returns `url` with the values of known-sensitive query parameters replaced,
 * leaving the path and every other parameter intact so logs stay useful.
 */
export const redactUrl = (url: string): string => {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);

  return `${path}?${query.split("&").map(redactPair).join("&")}`;
};

/**
 * The fields Fastify's default `req` serializer reads. Declared structurally so
 * this package needs no dependency on Fastify itself; a `FastifyRequest`
 * satisfies it.
 */
type LoggableRequest = {
  method: string;
  url: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
};

/**
 * Fastify's default `req` log serializer with the URL run through
 * {@link redactUrl}. Every other field is reproduced as Fastify emits it, so
 * the shape of an access log line is unchanged.
 */
export const redactedRequestSerializer = (request: LoggableRequest) => ({
  method: request.method,
  url: redactUrl(request.url),
  host: request.host,
  remoteAddress: request.ip,
  remotePort: request.socket?.remotePort,
});
