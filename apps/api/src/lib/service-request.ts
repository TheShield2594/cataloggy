import type { FastifyRequest } from "fastify";
import { deriveServiceToken, matchesServiceToken, SERVICE_TOKEN_HEADER } from "@cataloggy/shared";

// The addon authenticates with the same `API_TOKEN` the browser holds, so the
// bearer token cannot tell the two apart. The service token can: it is derived
// from `API_TOKEN` by both sides and never given to the browser, so a request
// carrying it is the addon service rather than any token holder.
//
// That distinction is what lets routes exist for the addon alone — reading the
// RPDB key, writing play signals — without those routes also being reachable by
// every holder of the shared token, an XSS'd tab included.
//
// Derived on demand rather than at import so a test (or a rotation) that
// changes `API_TOKEN` is seen, and memoised so the HMAC is not recomputed per
// request.
let derived: { apiToken: string; serviceToken: string } | null = null;

const expectedServiceToken = (): string | null => {
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) return null;
  if (derived?.apiToken !== apiToken) {
    derived = { apiToken, serviceToken: deriveServiceToken(apiToken) };
  }
  return derived.serviceToken;
};

/** Whether this request proves it comes from the addon service. */
export const isServiceRequest = (request: FastifyRequest): boolean =>
  matchesServiceToken(request.headers[SERVICE_TOKEN_HEADER], expectedServiceToken());
