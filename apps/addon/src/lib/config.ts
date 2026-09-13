import { parseProxyPathPrefixes, parseTrustProxy, parseBool } from "@cataloggy/shared";

/**
 * Everything this service reads out of its environment, read once.
 *
 * One module rather than a `process.env` lookup wherever a value is wanted:
 * these are startup configuration, and a value that is read at the moment it is
 * used is a value a deployment can appear to change without a restart.
 */

export const CATALOGGY_API_BASE = process.env.CATALOGGY_API_BASE ?? "http://api:7000";
export const CATALOGGY_API_TOKEN = process.env.CATALOGGY_API_TOKEN;
export const ADDON_PUBLIC_BASE = process.env.ADDON_PUBLIC_BASE;
export const WEB_PUBLIC_BASE = (process.env.CATALOGGY_WEB_PUBLIC ?? process.env.WEB_PUBLIC_BASE)?.replace(/\/+$/, "");
export const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/addon"] as const);

// Omitted rather than passed as `undefined` when `TRUST_PROXY` is unset:
// Fastify's `trustProxy?:` means "the key may be missing", and handing it an
// explicit undefined under `exactOptionalPropertyTypes` drops `fastify()` to
// its HTTP/2 overload — which typed every route registration against the wrong
// server and the wrong request.
export const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

/** Whether a `stream`/`subtitles` request is forwarded to the API as a play signal. */
export const PLAY_DETECTION = parseBool(process.env.STREMIO_PLAY_DETECTION);

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

/** The address this service tells Stremio to come back to, for the URLs it mints. */
export const addonBaseUrl = (): string => ADDON_PUBLIC_BASE ?? `http://localhost:${process.env.PORT ?? 7001}`;
