import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const API_TOKEN = process.env.API_TOKEN;

// timingSafeEqual needs two equal-length buffers and the presented token can be
// any length, so both sides are reduced to a fixed-width digest first. This is a
// comparison aid, not password storage: API_TOKEN is a high-entropy shared
// secret, nothing is persisted, and no KDF is wanted on a per-request auth path.
//
// CodeQL's js/insufficient-password-hash flags this (it wants bcrypt/argon2) and
// will keep flagging it — an HMAC under a random key trips the same rule. The
// alert predates this file's current shape; treat it as a known false positive
// rather than reaching for a slow KDF on every request.
const toSha256Digest = (value: string) => createHash("sha256").update(value).digest();

const API_TOKEN_DIGEST = API_TOKEN ? toSha256Digest(API_TOKEN) : null;

const bearerToken = (request: FastifyRequest): string | null => {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice("Bearer ".length).trim();
};

/**
 * Constant-time check that a request carries the configured API token, without
 * sending a reply. Used by surfaces that need to know whether a request is
 * authenticated but must not reject it themselves — currently the rate limiter,
 * which runs before {@link verifyToken} has had a chance to answer.
 */
export const hasValidApiToken = (request: FastifyRequest): boolean => {
  if (!API_TOKEN_DIGEST) return false;
  const token = bearerToken(request);
  if (token === null) return false;
  return timingSafeEqual(toSha256Digest(token), API_TOKEN_DIGEST);
};

export const verifyToken = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!API_TOKEN) {
    request.log.error("API_TOKEN is not configured");
    return reply.code(500).send({ error: "API token is not configured" });
  }

  if (!hasValidApiToken(request)) {
    // WWW-Authenticate (RFC 6750) marks this as a bearer-token failure specifically,
    // distinct from route-level 401s (e.g. an incorrect profile PIN) — the web client
    // uses it to tell "your API token is invalid, re-enter it" apart from other 401s.
    return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "Unauthorized" });
  }
};
