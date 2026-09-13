import type { FastifyBaseLogger } from "fastify";
import {
  discoveryApiPath,
  getDiscoveryCatalog,
  parseAddonConfigResponse,
  parseGenresResponse,
  parseListItemsResponse,
  parseListsResponse,
  parseMetasResponse,
  parsePreferencesResponse,
  parseRpdbConfigResponse,
} from "@cataloggy/shared";
import type {
  AddonManifestConfig,
  CataloggyList,
  CataloggyListItem,
  RpdbConfigResponse,
} from "@cataloggy/shared";
import { apiGet } from "./api-client.js";
import { cacheKeyFor, cacheSet, type CacheEntry } from "./cache.js";
import type { StremioMetaPreview } from "./stremio-types.js";

/**
 * Everything this service reads out of the API, each behind the TTL that suits
 * how often it changes.
 *
 * A read that fails falls back to the last answer rather than to nothing:
 * Stremio draws whatever it is given, so an empty list over a blip is a home
 * screen that visibly lost its rows, while a minute-old one is indistinguishable
 * from a fresh one. The exceptions are the reads a route already treats as
 * fatal — lists and list items — where an empty catalog is the honest answer.
 */

// Keyed by profile like the manifest it feeds, and read by the catalog routes
// too so they can apply the same enabled/disabled rule the manifest applied
// without a round trip per row Stremio draws.
const listsCache = new Map<string, CacheEntry<CataloggyList[]>>();
const LISTS_CACHE_TTL_MS = 60_000;

export const fetchAllLists = async (profileId: string | null): Promise<CataloggyList[]> => {
  const now = Date.now();
  const cacheKey = cacheKeyFor(profileId);
  const cached = listsCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const payload = await apiGet("/lists", profileId, parseListsResponse);
  cacheSet(listsCache, cacheKey, { data: payload.lists, expiry: now + LISTS_CACHE_TTL_MS });
  return payload.lists;
};

let cachedGenres: CacheEntry<string[]> | null = null;
const GENRES_CACHE_TTL_MS = 300_000;

export const fetchGenres = async (profileId: string | null, logger: FastifyBaseLogger): Promise<string[]> => {
  const now = Date.now();
  if (cachedGenres && now < cachedGenres.expiry) return cachedGenres.data;

  try {
    const payload = await apiGet("/genres", profileId, parseGenresResponse);
    cachedGenres = { data: payload.genres, expiry: now + GENRES_CACHE_TTL_MS };
    return payload.genres;
  } catch (error) {
    logger.warn(error, "Failed to fetch genres, using cached value");
    return cachedGenres?.data ?? [];
  }
};

let cachedRpdb: CacheEntry<RpdbConfigResponse> | null = null;
const RPDB_CACHE_TTL_MS = 120_000;
const RPDB_BASE_URL = "https://api.ratingposterdb.com";

export const fetchRpdbConfig = async (
  profileId: string | null,
  logger: FastifyBaseLogger
): Promise<RpdbConfigResponse> => {
  const now = Date.now();
  if (cachedRpdb && now < cachedRpdb.expiry) return cachedRpdb.data;

  try {
    const payload = await apiGet("/rpdb/config", profileId, parseRpdbConfigResponse);
    cachedRpdb = { data: payload, expiry: now + RPDB_CACHE_TTL_MS };
    return payload;
  } catch (error) {
    logger.warn(error, "Failed to fetch RPDB config, using cached value");
    const fallback: RpdbConfigResponse = { enabled: false, apiKey: null };
    return cachedRpdb?.data ?? fallback;
  }
};

export const applyRpdbPoster = (imdbId: string, rpdbKey: string): string =>
  `${RPDB_BASE_URL}/${rpdbKey}/imdb/poster-default/${imdbId}.jpg`;

export const applyRpdbToMetas = (metas: StremioMetaPreview[], rpdbKey: string | null): StremioMetaPreview[] => {
  if (!rpdbKey) return metas;
  return metas.map((meta) => ({
    ...meta,
    poster: applyRpdbPoster(meta.id, rpdbKey),
  }));
};

// Which catalogs exist, what they are called and which API endpoint serves each
// one all come from @cataloggy/shared, so this service and the API's own
// manifest can no longer disagree about the set — which is how "AI Picks" came
// to be offered in Settings and then silently dropped here.
const trendingPopularCache = new Map<string, CacheEntry<StremioMetaPreview[]>>();
const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const fetchDiscoveryMetas = async (
  catalogId: string,
  profileId: string | null,
  logger: FastifyBaseLogger
): Promise<StremioMetaPreview[]> => {
  const now = Date.now();
  const cacheKey = `${cacheKeyFor(profileId)}:${catalogId}`;
  const cached = trendingPopularCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const catalog = getDiscoveryCatalog(catalogId);
  if (!catalog) return [];

  try {
    const payload = await apiGet(discoveryApiPath(catalog), profileId, parseMetasResponse);
    const metas: StremioMetaPreview[] = payload.metas.map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      ...(m.poster ? { poster: m.poster } : {}),
      posterShape: "poster" as const,
      ...(m.genres?.length ? { genres: m.genres } : {}),
    }));
    cacheSet(trendingPopularCache, cacheKey, { data: metas, expiry: now + TRENDING_CACHE_TTL_MS });
    return metas;
  } catch (error) {
    logger.warn(error, `Failed to fetch discovery catalog ${catalogId}, using cached value`);
    return cached?.data ?? [];
  }
};

// The enabled-catalog config is per-profile, so the cache is keyed by profile
// too — otherwise the first profile to build a manifest would decide which
// catalogs every other profile sees for the next minute.
const enabledCatalogsCache = new Map<string, CacheEntry<AddonManifestConfig>>();
const ENABLED_CATALOGS_CACHE_TTL_MS = 60_000;

export const fetchAddonConfig = async (
  profileId: string | null,
  logger: FastifyBaseLogger
): Promise<AddonManifestConfig | null> => {
  const now = Date.now();
  const cacheKey = cacheKeyFor(profileId);
  const cached = enabledCatalogsCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  try {
    const config = await apiGet("/addon/config", profileId, parseAddonConfigResponse);
    cacheSet(enabledCatalogsCache, cacheKey, { data: config, expiry: now + ENABLED_CATALOGS_CACHE_TTL_MS });
    return config;
  } catch (error) {
    logger.warn(error, "Failed to fetch addon config, using cached value");
    return cached?.data ?? null;
  }
};

// The one catalog input that had no cache at all, and the most expensive to go
// without: Stremio asks for one catalog per (list, type) pair, so a home screen
// with three lists installed used to pull all three lists in full, twice each,
// on every refresh.
//
// Shorter-lived than the manifest and lists caches (60s) because list membership
// is what a user changes and then immediately looks for in Stremio, while the
// set of lists itself barely moves. Keyed by type as well as list, since the
// request is now typed and the two types are different payloads.
const listItemsCache = new Map<string, CacheEntry<CataloggyListItem[]>>();
const LIST_ITEMS_CACHE_TTL_MS = 30_000;

export const fetchListItems = async (
  listId: string,
  profileId: string | null,
  type: string
): Promise<CataloggyListItem[]> => {
  const now = Date.now();
  // Two keys per list rather than one, so this map fills toward MAX_CACHE_ENTRIES
  // twice as fast as the others — the bound in cacheSet is what keeps that in check.
  const cacheKey = `${cacheKeyFor(profileId)}:${listId}:${type}`;
  const cached = listItemsCache.get(cacheKey);
  if (cached && now < cached.expiry) return cached.data;

  const payload = await apiGet(
    `/lists/${encodeURIComponent(listId)}/items?type=${encodeURIComponent(type)}`,
    profileId,
    parseListItemsResponse
  );
  // Dated from when the answer arrived, not from when it was asked for. The API
  // call is the slow part, and a 30s TTL measured from before it means a request
  // that took longer than that is cached already expired — so a slow API gets
  // hammered by the retry rather than shielded by the cache.
  cacheSet(listItemsCache, cacheKey, {
    data: payload.items,
    expiry: Date.now() + LIST_ITEMS_CACHE_TTL_MS,
  });
  return payload.items;
};

let cachedSpoilerProtection: CacheEntry<boolean> | null = null;
const SPOILER_CACHE_TTL_MS = 60_000;

export const isSpoilerProtectionEnabled = async (
  profileId: string | null,
  logger: FastifyBaseLogger
): Promise<boolean> => {
  const now = Date.now();
  if (cachedSpoilerProtection && now < cachedSpoilerProtection.expiry) {
    return cachedSpoilerProtection.data;
  }
  try {
    const prefs = await apiGet("/settings/preferences", profileId, parsePreferencesResponse);
    const enabled = prefs.spoilerProtection === true;
    cachedSpoilerProtection = { data: enabled, expiry: now + SPOILER_CACHE_TTL_MS };
    return enabled;
  } catch (error) {
    logger.warn(error, "Failed to fetch spoiler protection setting, using cached value");
    return cachedSpoilerProtection?.data ?? false;
  }
};
