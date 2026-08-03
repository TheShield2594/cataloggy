import { createHmac, timingSafeEqual } from "node:crypto";

/** Header the addon sends to identify its calls to the API as service traffic. */
export const SERVICE_TOKEN_HEADER = "x-cataloggy-service-token";

const SERVICE_TOKEN_LABEL = "cataloggy-service-client";

/**
 * Derives the addon's service token from the shared API token.
 *
 * The addon has to prove it *is* the addon, not merely that it holds
 * `API_TOKEN` — the browser holds that too, so the raw token cannot tell the
 * two apart. Deriving costs no extra configuration (both sides already have
 * `API_TOKEN`) and keeps the blast radius small: the derived value grants
 * nothing on its own, and does not yield the token it came from.
 *
 * Same construction as the addon's mutation token in `apps/addon/src/app.ts`.
 */
export const deriveServiceToken = (apiToken: string): string =>
  createHmac("sha256", apiToken).update(SERVICE_TOKEN_LABEL).digest("hex");

/**
 * Constant-time comparison of a presented service token against the expected
 * one. Both are fixed-width hex digests, so the length guard — needed because
 * `timingSafeEqual` throws on a length mismatch — cannot leak anything about
 * the secret.
 */
export const matchesServiceToken = (candidate: unknown, expected: string | null): boolean => {
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  const presented = Buffer.from(candidate);
  const wanted = Buffer.from(expected);
  if (presented.length !== wanted.length) return false;
  return timingSafeEqual(presented, wanted);
};
