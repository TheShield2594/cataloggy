import { LRUCache } from "lru-cache";
import type { CastMember, SeasonInfo, WatchProviders } from "../tmdb.js";
import type { StremioMetaPreview } from "./types.js";

export type TrendingCacheEntry = { data: StremioMetaPreview[]; reasons?: Record<string, string> };

export const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000;
export const CAST_CACHE_TTL_MS = 60 * 60 * 1000;
export const WATCH_PROVIDERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EXTERNAL_IDS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Short-lived: this only exists to collapse the burst of watched-history lookups
// that back-to-back requests (e.g. the movie + series AI recs calls on page load)
// trigger, not to serve as a source of truth — kept well under a minute so a
// just-recorded watch event is reflected almost immediately.
export const WATCHED_IMDB_IDS_CACHE_TTL_MS = 30 * 1000;

export const trendingCache = new LRUCache<string, TrendingCacheEntry>({ max: 100, ttl: TRENDING_CACHE_TTL_MS });
export const watchedImdbIdsCache = new LRUCache<string, Set<string>>({
  max: 200,
  ttl: WATCHED_IMDB_IDS_CACHE_TTL_MS,
});
export const castCache = new LRUCache<string, CastMember[]>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const seasonsCache = new LRUCache<string, SeasonInfo[]>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const watchProvidersCache = new LRUCache<string, WatchProviders>({
  max: 1000,
  ttl: WATCH_PROVIDERS_CACHE_TTL_MS,
});
export const externalIdsCache = new LRUCache<string, { imdbId: string | null }>({
  max: 5000,
  ttl: EXTERNAL_IDS_CACHE_TTL_MS,
});

export const trendingCacheGet = (key: string): TrendingCacheEntry | undefined => trendingCache.get(key);

export const trendingCacheSet = (key: string, entry: TrendingCacheEntry, ttl?: number) => {
  trendingCache.set(key, entry, ttl !== undefined ? { ttl } : undefined);
};

export const trendingCacheDelete = (key: string) => {
  trendingCache.delete(key);
};

export const trendingCacheDeletePrefix = (prefix: string) => {
  for (const key of [...trendingCache.keys()]) {
    if (key.startsWith(prefix)) trendingCache.delete(key);
  }
};
