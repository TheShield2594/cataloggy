import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const API_TOKEN = process.env.API_TOKEN;

const toSha256Digest = (value: string) => createHash("sha256").update(value).digest();

// Hashed once at load, then compared in constant time against the digest of
// whatever a request presents. The hashing exists only to hand timingSafeEqual
// two equal-length buffers — this is not password storage, and API_TOKEN is a
// high-entropy shared secret rather than a user-chosen password.
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
