/**
 * Identifies service-to-service callers of the API.
 *
 * The addon calls the API with the same `API_TOKEN` the browser uses, so the
 * bearer token alone cannot tell the two apart. This header lets the API give
 * internal traffic its own rate-limit bucket — see the limiter comment in
 * `apps/api/src/index.ts`.
 */
export const SERVICE_CLIENT_HEADER = "x-cataloggy-client";

/** Value the Stremio addon service sends in {@link SERVICE_CLIENT_HEADER}. */
export const ADDON_SERVICE_CLIENT = "addon";
