import { LRUCache } from "lru-cache";
import type { Credits, EpisodeInfo, SeasonInfo, ShowDetails, WatchProviders } from "../tmdb.js";
import type { StremioMetaPreview } from "./types.js";

export type TrendingCacheEntry = { data: StremioMetaPreview[]; reasons?: Record<string, string> };

export const TRENDING_CACHE_TTL_MS = 30 * 60 * 1000;
export const CAST_CACHE_TTL_MS = 60 * 60 * 1000;
export const WATCH_PROVIDERS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EXTERNAL_IDS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// next_episode_to_air/status rarely change within a day; this is refetched on every
// /calendar load and dashboard "Upcoming" widget render for every in-progress series.
export const SHOW_DETAILS_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
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
export const castCache = new LRUCache<string, Credits>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const seasonsCache = new LRUCache<string, SeasonInfo[]>({ max: 500, ttl: CAST_CACHE_TTL_MS });
export const episodesCache = new LRUCache<string, EpisodeInfo[]>({ max: 1000, ttl: CAST_CACHE_TTL_MS });
export const watchProvidersCache = new LRUCache<string, WatchProviders>({
  max: 1000,
  ttl: WATCH_PROVIDERS_CACHE_TTL_MS,
});
export const externalIdsCache = new LRUCache<string, { imdbId: string | null }>({
  max: 5000,
  ttl: EXTERNAL_IDS_CACHE_TTL_MS,
});
export const showDetailsCache = new LRUCache<string, { details: ShowDetails }>({
  max: 1000,
  ttl: SHOW_DETAILS_CACHE_TTL_MS,
});

// A metadata backfill that comes back empty — TMDB has no match for that IMDb ID
// under the type the item is filed as, which happens when the two disagree on
// whether something is a movie or a series — would otherwise be retried on every
// single list load. Park those IDs instead of hammering TMDB for a row that is
// not going to appear.
export const METADATA_BACKFILL_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const metadataBackfillCooldownCache = new LRUCache<string, true>({
  max: 5000,
  ttl: METADATA_BACKFILL_COOLDOWN_MS,
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
