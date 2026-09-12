/*
 * The read-only API routes that may be cached, and which tier each belongs to.
 *
 * This is the one description of that route space. It used to be three, written
 * out by hand in three places that had to agree and didn't:
 *
 *  - the API's response headers (`apps/api/src/lib/http-cache.ts`),
 *  - the service worker's runtime cache (`apps/web/src/sw.js`),
 *  - and, loosely, the in-memory `dataCache` the first render frame reads.
 *
 * The drift was silent in both directions. The worker matched `meta(/.*)?`
 * wholesale, so it also caught `/meta/:type/:id/bundle`, which the API
 * deliberately keeps out of the long-lived tier because the bundle carries the
 * profile's own dropped flag. It matched `recommendations(/.*)?` the same way,
 * over `/recommendations/personal` and `/recommendations/ai`, which are
 * generated from that profile's history. And it had never heard of `collection`,
 * `games`, `tags` or `anime` at all — routes the API has long declared
 * cacheable, which therefore simply did not work offline.
 *
 * The two consumers ask different questions of this list, which is why it is a
 * table rather than a pair of regexes:
 *
 *  - The API asks *which tier*, because the tier picks the `Cache-Control`
 *    header. `metadata` is a real `max-age` in the browser's own HTTP cache,
 *    which nothing in the app can reach into to invalidate, so a route only
 *    belongs there if no user action can change its answer. `revalidate`
 *    spends a round trip and an ETag instead.
 *
 *  - The service worker asks only *whether*, and caches every route here. Its
 *    cache is dropped wholesale on any mutation and on a profile switch (see
 *    INVALIDATE_API_CACHE in sw.js), so the per-profile, mutable routes that
 *    must stay out of the browser's HTTP cache are safe in this one.
 *
 * Ordering is significant: the first pattern that matches the whole path wins,
 * so the narrow entries come before the prefixes they sit under. That ordering
 * is what keeps `/meta/movie/tt1/bundle` in `revalidate` while
 * `/meta/movie/tt1` is `metadata`, and it replaces the negative lookahead that
 * used to encode the same exception.
 */

export type CacheTier = "metadata" | "revalidate";

export type ApiCacheRoute = {
  /**
   * Path pattern relative to the API base, without the leading slash.
   *
   * Matched anchored against the whole path, so a pattern that should cover
   * sub-paths has to say so. Groups must be non-capturing: the combined matcher
   * below wraps each pattern in a capture group of its own to find out which
   * one matched.
   */
  readonly pattern: string;
  readonly tier: CacheTier;
};

export const API_CACHE_ROUTES: readonly ApiCacheRoute[] = [
  // ─── Narrow entries first ───
  //
  // Each of these sits under a `metadata` prefix below and has to be pulled back
  // out of it: they are per-profile and the user's own actions change them. The
  // bundle carries the dropped flag; the two recommendation feeds are generated
  // from the profile's watch history.
  { pattern: "meta/[^/]+/[^/]+/bundle", tier: "revalidate" },
  { pattern: "recommendations/personal", tier: "revalidate" },
  { pattern: "recommendations/ai", tier: "revalidate" },

  // ─── Facts about a title ───
  //
  // TMDB-derived and the same for everyone, so the browser may answer from its
  // own cache without asking. `recommendations` is the bare "more like this"
  // feed and stays exact on purpose — a future `recommendations/<something>`
  // should have to choose a tier rather than inherit this one.
  { pattern: "meta/.+", tier: "metadata" },
  { pattern: "recommendations", tier: "metadata" },
  { pattern: "trending(?:/.*)?", tier: "metadata" },
  { pattern: "popular(?:/.*)?", tier: "metadata" },
  { pattern: "anime(?:/.*)?", tier: "metadata" },
  { pattern: "streaming(?:/.*)?", tier: "metadata" },

  // ─── What the user owns ───
  //
  // Watchlist, lists, history, stats, progress, calendar, collection, games,
  // tags. A `max-age` on any of these would outlive the mutation that should
  // have replaced it, so they get an ETag and a round trip.
  { pattern: "watchlist", tier: "revalidate" },
  { pattern: "continue", tier: "revalidate" },
  { pattern: "recent", tier: "revalidate" },
  { pattern: "series/progress", tier: "revalidate" },
  { pattern: "watch/history", tier: "revalidate" },
  { pattern: "watch/stats(?:/detailed)?", tier: "revalidate" },
  { pattern: "lists(?:/.*)?", tier: "revalidate" },
  { pattern: "calendar", tier: "revalidate" },
  { pattern: "collection", tier: "revalidate" },
  { pattern: "games(?:/.*)?", tier: "revalidate" },
  { pattern: "tags", tier: "revalidate" },
];

/**
 * The routes' patterns as one alternation, each wrapped in a capture group.
 *
 * Consumers anchor this themselves, because they are matching different things:
 * the API and the worker's exact test both anchor at `^/`, while the worker's
 * pre-API-base fallback anchors at `(?:^|/)` so it can match the tail of a
 * proxied path. Leftmost alternation means the table's order is preserved
 * either way.
 */
export const API_CACHE_PATH_ALTERNATION = API_CACHE_ROUTES.map(
  (route) => `(${route.pattern})`
).join("|");

/**
 * Matches any cacheable path, ignoring the tier — the yes/no the service worker
 * asks. `cacheTierForPath` reads the same match's groups to answer the API's
 * narrower question, so there is one regex rather than two that could disagree.
 */
export const API_CACHE_PATH_RE = new RegExp(`^/(?:${API_CACHE_PATH_ALTERNATION})$`);

/**
 * The tier a path belongs to, or null if it is not cacheable.
 *
 * `path` must already have any query string removed — every pattern is anchored
 * at the end, so a trailing `?…` would match nothing.
 */
export function cacheTierForPath(path: string): CacheTier | null {
  const match = API_CACHE_PATH_RE.exec(path);
  if (!match) return null;
  // One capture group per route, in table order; the populated one names the
  // pattern that matched.
  for (const [i, route] of API_CACHE_ROUTES.entries()) {
    if (match[i + 1] !== undefined) return route.tier;
  }
  /* c8 ignore next -- the regex only matches when one of the groups did */
  return null;
}
