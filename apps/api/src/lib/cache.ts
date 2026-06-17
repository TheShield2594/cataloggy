import { LRUCache } from "lru-cache";
import type { CastMember, SeasonInfo, WatchProviders } from "../tmdb.js";
import type { StremioMetaPreview } from "./types.js";

export type TrendingCacheEntry = { data: StremioMetaPreview[]; reasons?: Record<string, string> };

export const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000;
export const CAST_CACHE_TTL_MS = 60 * 60 * 1000;
export const WATCH_PROVIDERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const trendingCache = new LRUCache<string, TrendingCacheEntry>({ max: 100, ttl: TRENDING_CACHE_TTL_MS });
export const castCache = new LRUCache<string, CastMember[]>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const seasonsCache = new LRUCache<string, SeasonInfo[]>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const watchProvidersCache = new LRUCache<string, WatchProviders>({
  max: 1000,
  ttl: WATCH_PROVIDERS_CACHE_TTL_MS,
});

export const trendingCacheGet = (key: string): TrendingCacheEntry | undefined => trendingCache.get(key);

export const trendingCacheSet = (key: string, entry: TrendingCacheEntry, ttl?: number) => {
  trendingCache.set(key, entry, ttl !== undefined ? { ttl } : undefined);
};

export const trendingCacheDeletePrefix = (prefix: string) => {
  for (const key of [...trendingCache.keys()]) {
    if (key.startsWith(prefix)) trendingCache.delete(key);
  }
};
