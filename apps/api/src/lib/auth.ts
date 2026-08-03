import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const API_TOKEN = process.env.API_TOKEN;

const toSha256Digest = (value: string) => createHash("sha256").update(value).digest();

export const verifyToken = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!API_TOKEN) {
    request.log.error("API_TOKEN is not configured");
    return reply.code(500).send({ error: "API token is not configured" });
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    // WWW-Authenticate (RFC 6750) marks this as a bearer-token failure specifically,
    // distinct from route-level 401s (e.g. an incorrect profile PIN) — the web client
    // uses it to tell "your API token is invalid, re-enter it" apart from other 401s.
    return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "Unauthorized" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  const tokenDigest = toSha256Digest(token);
  const expectedTokenDigest = toSha256Digest(API_TOKEN);

  if (!timingSafeEqual(tokenDigest, expectedTokenDigest)) {
    return reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "Unauthorized" });
  }
};
