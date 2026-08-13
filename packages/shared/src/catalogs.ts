// The Stremio catalog registry.
//
// Three surfaces describe the same set of catalogs: the API's `/addon/stremio/…`
// manifest, the addon service's `/manifest.json`, and the Settings picker that
// decides which of them a profile wants. Each used to keep its own copy of the
// list, and the copies disagreed — "AI Picks" was offered in Settings, honoured
// by the API and silently dropped by the addon, because the addon's copy had no
// such entry. This module is the one place a catalog is declared; every surface
// derives from it, so adding one is a single edit and dropping one is a compile
// error rather than an empty row in Stremio.

export type StremioCatalogType = "movie" | "series";

/**
 * Where a discovery catalog's rows come from. The API turns this into a TMDB
 * call (and a cache key); the addon service turns it into the API path it
 * proxies to. Keeping it structured rather than stringly-typed is what lets
 * both derivations stay in step.
 */
export type DiscoverySource =
  | { kind: "trending" }
  | { kind: "popular" }
  | { kind: "recommended" }
  | { kind: "ai" }
  | { kind: "anime" }
  | { kind: "streaming"; provider: string };

export type DiscoveryCatalog = {
  /** Stremio catalog id, and the string stored in a profile's enabled-catalog config. */
  id: string;
  type: StremioCatalogType;
  /** Row title shown in Stremio and in the Settings picker. */
  label: string;
  source: DiscoverySource;
};

export const DISCOVERY_CATALOGS: readonly DiscoveryCatalog[] = [
  { id: "cataloggy-trending-movie",     type: "movie",  label: "Trending Movies",     source: { kind: "trending" } },
  { id: "cataloggy-trending-series",    type: "series", label: "Trending Series",     source: { kind: "trending" } },
  { id: "cataloggy-popular-movie",      type: "movie",  label: "Popular Movies",      source: { kind: "popular" } },
  { id: "cataloggy-popular-series",     type: "series", label: "Popular Series",      source: { kind: "popular" } },
  { id: "cataloggy-recommended-movie",  type: "movie",  label: "Recommended Movies",  source: { kind: "recommended" } },
  { id: "cataloggy-recommended-series", type: "series", label: "Recommended Series",  source: { kind: "recommended" } },
  { id: "cataloggy-ai-movie",           type: "movie",  label: "AI Picks — Movies",   source: { kind: "ai" } },
  { id: "cataloggy-ai-series",          type: "series", label: "AI Picks — Series",   source: { kind: "ai" } },
  { id: "cataloggy-anime-series",       type: "series", label: "Anime",               source: { kind: "anime" } },
  { id: "cataloggy-anime-movie",        type: "movie",  label: "Anime Movies",        source: { kind: "anime" } },
  { id: "cataloggy-netflix-movie",      type: "movie",  label: "Netflix Movies",      source: { kind: "streaming", provider: "netflix" } },
  { id: "cataloggy-netflix-series",     type: "series", label: "Netflix Series",      source: { kind: "streaming", provider: "netflix" } },
  { id: "cataloggy-disney-movie",       type: "movie",  label: "Disney+ Movies",      source: { kind: "streaming", provider: "disney" } },
  { id: "cataloggy-disney-series",      type: "series", label: "Disney+ Series",      source: { kind: "streaming", provider: "disney" } },
  { id: "cataloggy-amazon-movie",       type: "movie",  label: "Prime Video Movies",  source: { kind: "streaming", provider: "amazon" } },
  { id: "cataloggy-amazon-series",      type: "series", label: "Prime Video Series",  source: { kind: "streaming", provider: "amazon" } },
  { id: "cataloggy-apple-movie",        type: "movie",  label: "Apple TV+ Movies",    source: { kind: "streaming", provider: "apple" } },
  { id: "cataloggy-apple-series",       type: "series", label: "Apple TV+ Series",    source: { kind: "streaming", provider: "apple" } },
  { id: "cataloggy-max-movie",          type: "movie",  label: "Max Movies",          source: { kind: "streaming", provider: "max" } },
  { id: "cataloggy-max-series",         type: "series", label: "Max Series",          source: { kind: "streaming", provider: "max" } },
];

export const DISCOVERY_CATALOG_IDS: readonly string[] = DISCOVERY_CATALOGS.map((c) => c.id);

const CATALOGS_BY_ID = new Map(DISCOVERY_CATALOGS.map((c) => [c.id, c]));

export const getDiscoveryCatalog = (id: string): DiscoveryCatalog | null => CATALOGS_BY_ID.get(id) ?? null;

export const isDiscoveryCatalogId = (id: string): boolean => CATALOGS_BY_ID.has(id);

/** What a profile that has never opened the Settings picker gets. */
export const DEFAULT_DISCOVERY_CATALOG_IDS: readonly string[] = [
  "cataloggy-trending-movie", "cataloggy-trending-series",
  "cataloggy-popular-movie", "cataloggy-popular-series",
  "cataloggy-recommended-movie", "cataloggy-recommended-series",
];

/**
 * True for catalogs that have nothing to show until an AI provider is
 * configured. Both manifests drop these otherwise: an AI row that quietly
 * serves TMDB's "people also watched" is worse than no row.
 */
export const catalogRequiresAi = (catalog: DiscoveryCatalog): boolean => catalog.source.kind === "ai";

/**
 * The catalogs a manifest should advertise, given what the profile enabled and
 * whether AI is available. Both manifests call this so they can never disagree
 * about what an enabled catalog means.
 */
export const selectDiscoveryCatalogs = (
  enabledCatalogIds: readonly string[],
  options: { aiConfigured: boolean }
): DiscoveryCatalog[] => {
  const enabled = new Set(enabledCatalogIds);
  return DISCOVERY_CATALOGS.filter(
    (catalog) => enabled.has(catalog.id) && (options.aiConfigured || !catalogRequiresAi(catalog))
  );
};

/**
 * The API path serving this catalog's rows. Only the addon service calls it —
 * the API reaches the same data in-process — but it lives here so a renamed
 * route is one edit rather than a catalog that returns 404 into an empty row.
 */
export const discoveryApiPath = (catalog: DiscoveryCatalog): string => {
  switch (catalog.source.kind) {
    case "trending":
      return `/trending?type=${catalog.type}`;
    case "popular":
      return `/popular?type=${catalog.type}`;
    case "recommended":
      return `/recommendations/personal?type=${catalog.type}`;
    case "ai":
      return `/recommendations/ai?type=${catalog.type}`;
    case "anime":
      return `/anime?type=${catalog.type}`;
    case "streaming":
      return `/streaming?type=${catalog.type}&provider=${catalog.source.provider}`;
  }
};

// ─── User list catalogs ───
//
// A profile's own lists are catalogs too, but they can't be enumerated ahead of
// time. They are stored in the same enabled-catalog array under this prefix.

export const LIST_CATALOG_PREFIX = "list:";

export const listCatalogId = (listId: string): string => `${LIST_CATALOG_PREFIX}${listId}`;

/** The list id inside a `list:<uuid>` config entry, or null if this isn't one. */
export const parseListCatalogId = (catalogId: string): string | null =>
  catalogId.startsWith(LIST_CATALOG_PREFIX) ? catalogId.slice(LIST_CATALOG_PREFIX.length) : null;

// ─── Legacy ids ───
//
// The first version of the picker stored the API's core catalog ids. They still
// turn up in configs written before the rename, so they are translated on read
// rather than silently dropped.

export const LEGACY_CATALOG_MAP: Readonly<Record<string, string>> = {
  my_watchlist_movies: "cataloggy-trending-movie",
  my_watchlist_series: "cataloggy-trending-series",
  my_recent_movies: "cataloggy-popular-movie",
  my_continue_series: "cataloggy-popular-series",
};

export const migrateLegacyCatalogs = (catalogs: readonly string[]): string[] =>
  catalogs.map((c) => LEGACY_CATALOG_MAP[c] ?? c);
