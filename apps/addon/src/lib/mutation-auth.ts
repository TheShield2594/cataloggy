import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { CATALOGGY_API_TOKEN } from "./config.js";

/**
 * What is allowed to write through this service.
 *
 * The addon's URL is necessarily shared (to install it in Stremio/Omni), so
 * anyone who has it can reach the mutation routes. An Origin-header check alone
 * isn't real auth — it only stops browser-issued cross-origin requests; nothing
 * stops a direct script/curl request from setting its own Origin header. So
 * mutations additionally require a token derived from the shared
 * CATALOGGY_API_TOKEN (never the raw token itself, to cap the blast radius if a
 * URL containing it leaks — e.g. via proxy/access logs).
 *
 * Scrobble callers (media-player integrations, capable of setting headers) send
 * this as a standard Bearer token. It is never emitted from a route — see
 * `lib/mark-watched.ts` for why /subtitles cannot hand it out.
 */
const MUTATION_TOKEN = CATALOGGY_API_TOKEN
  ? createHmac("sha256", CATALOGGY_API_TOKEN).update("cataloggy-addon-mutation").digest("hex")
  : null;

// Fastify doesn't validate query/header types against the route's TS generics at
// runtime, so a repeated query param (e.g. "?token=a&token=b") can arrive as a
// string[] despite the declared type — hence the explicit typeof guard rather
// than letting Buffer.from throw on a non-string value.
export const tokensMatch = (candidate: unknown, expected: string | null): boolean => {
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

export const isValidMutationToken = (candidate: unknown): boolean => tokensMatch(candidate, MUTATION_TOKEN);

const STREMIO_WEB_ORIGINS = ["https://web.strem.io", "https://app.strem.io"];

export const isAllowedMutationOrigin = (request: FastifyRequest): boolean => {
  const origin = request.headers.origin;
  if (!origin) return true;
  return STREMIO_WEB_ORIGINS.includes(origin);
};
