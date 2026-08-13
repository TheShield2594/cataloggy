/*
 * The artwork CDNs every poster, backdrop, logo and cast photo comes from.
 *
 * Two places read this list, and they must not drift apart:
 *
 *  - `sw.js`, which caches these responses. Caching them means the service
 *    worker handles the request and re-issues it with `fetch()`.
 *  - the CSP, built in `scripts/csp.mjs` — both `img-src` and `connect-src`.
 *
 * Two directives rather than one, because a poster is fetched two ways.
 * `img-src` governs an <img> the browser loads itself. But once a service
 * worker answers that request, the load becomes a `fetch()` from the worker —
 * and a fetch is a connection, so `connect-src` is the directive that decides
 * then. A host missing from either fails one of those paths: out of `img-src`
 * and the tag is blocked outright, out of `connect-src` and the cached fetch
 * fails, which the caching strategy has no choice but to turn into a broken
 * image even though the network would have served the picture perfectly well.
 *
 * Plain ESM with an explicit extension because both readers are unusual: one
 * is bundled into a service worker, the other is run by bare `node` inside the
 * runtime container, where there is no package.json to declare a module type.
 */

/** Origins, for the CSP — a `connect-src` source is an origin, not a hostname. */
export const IMAGE_CDN_ORIGINS = [
  "https://image.tmdb.org",
  "https://images.igdb.com",
  "https://media.steampowered.com",
  "https://api.ratingposterdb.com",
];

/** The same CDNs as hostnames, for matching a request in the service worker. */
export const IMAGE_CDN_HOSTS = new Set(
  IMAGE_CDN_ORIGINS.map((origin) => new URL(origin).hostname)
);
