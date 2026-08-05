import type { LRUCache } from "lru-cache";
import type { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";
import { fetchMetadata } from "./metadata.js";
import { getRpdbApiKey, withRpdbPoster } from "./rpdb.js";
import { getRegionSetting } from "./settings.js";
import { castCache, episodesCache, seasonsCache, watchProvidersCache } from "./cache.js";
import { coalesce } from "./coalesce.js";
import type { Credits, EpisodeInfo, SeasonInfo, WatchProviders } from "../tmdb.js";

const EMPTY_PROVIDERS: WatchProviders = { link: null, flatrate: [], free: [], ads: [] };

/**
 * Maps an IMDb ID to the TMDB ID everything else is keyed on, backfilling the
 * metadata row from TMDB when we have never seen the title before.
 *
 * Four routes needed this and each did it inline, so a cold detail panel ran the
 * same `findUnique` four times and could start four identical backfills against
 * TMDB. Coalescing collapses that to one lookup and one backfill that the rest
 * wait on.
 */
export function resolveTmdbId(
  type: MetadataType,
  imdbId: string,
  log?: FastifyBaseLogger
): Promise<number | null> {
  return coalesce(`tmdbId:${type}:${imdbId}`, async () => {
    const existing = await prisma.metadata.findUnique({
      where: { imdbId_type: { imdbId, type } },
      select: { tmdbId: true },
    });
    if (existing?.tmdbId) return existing.tmdbId;

    await fetchMetadata(type, imdbId).catch((err) =>
      log?.warn({ imdbId, type, err }, "Background metadata fetch failed")
    );

    const backfilled = await prisma.metadata.findUnique({
      where: { imdbId_type: { imdbId, type } },
      select: { tmdbId: true },
    });
    return backfilled?.tmdbId ?? null;
  });
}

/**
 * The shape every TMDB-backed section shares: read the cache, resolve the TMDB
 * ID, then fetch under a coalesced guard, re-checking the cache inside it
 * because the ID resolution is itself an await another caller may have used to
 * get there first. Any upstream failure degrades to `fallback` rather than
 * propagating — one empty section beats a panel that won't open.
 */
async function loadCached<T extends NonNullable<unknown>>(
  cache: LRUCache<string, T>,
  cacheKey: string,
  type: MetadataType,
  imdbId: string,
  fetchFrom: (tmdbId: number) => Promise<T>,
  fallback: T,
  log?: FastifyBaseLogger
): Promise<T> {
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const tmdbId = await resolveTmdbId(type, imdbId, log);
  if (!tmdbId) return fallback;

  return coalesce(cacheKey, async () => {
    const raced = cache.get(cacheKey);
    if (raced !== undefined) return raced;
    try {
      const value = await fetchFrom(tmdbId);
      cache.set(cacheKey, value);
      return value;
    } catch {
      return fallback;
    }
  });
}

export function loadCast(
  type: MetadataType,
  imdbId: string,
  log?: FastifyBaseLogger
): Promise<Credits> {
  return loadCached(
    castCache,
    `cast:${type}:${imdbId}`,
    type,
    imdbId,
    async (tmdbId) => (await getTmdb()).getCast(type, tmdbId),
    { cast: [], director: null },
    log
  );
}

export function loadSeasons(imdbId: string, log?: FastifyBaseLogger): Promise<SeasonInfo[]> {
  return loadCached(
    seasonsCache,
    `seasons:${imdbId}`,
    "series",
    imdbId,
    async (tmdbId) => (await getTmdb()).getSeasons(tmdbId),
    [],
    log
  );
}

export function loadEpisodes(
  imdbId: string,
  seasonNumber: number,
  log?: FastifyBaseLogger
): Promise<EpisodeInfo[]> {
  return loadCached(
    episodesCache,
    `episodes:${imdbId}:${seasonNumber}`,
    "series",
    imdbId,
    async (tmdbId) => (await getTmdb()).getSeasonEpisodes(tmdbId, seasonNumber),
    [],
    log
  );
}

export async function loadProviders(
  type: MetadataType,
  imdbId: string,
  log?: FastifyBaseLogger
): Promise<WatchProviders> {
  // The region is part of the cache key, so it has to be resolved before the
  // key exists — unlike the others, this one cannot be a pure delegation.
  const region = await getRegionSetting();
  return loadCached(
    watchProvidersCache,
    `providers:${type}:${imdbId}:${region}`,
    type,
    imdbId,
    async (tmdbId) => (await getTmdb()).getWatchProviders(type, tmdbId, region),
    EMPTY_PROVIDERS,
    log
  );
}

/**
 * The row behind `GET /meta/:type/:imdbId`, with the RPDB poster substitution
 * applied. Returns null when TMDB has nothing under this ID and type.
 */
export async function loadMeta(type: MetadataType, imdbId: string) {
  const [existing, rpdbKey] = await Promise.all([
    prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } } }),
    getRpdbApiKey(),
  ]);

  // A row that is merely present isn't enough: a row predating a full sync is
  // missing the fields the detail panel wants, and has to be refetched.
  //
  // Which fields count is not the same for both types. `network` is only ever
  // populated for series — TMDB has no such concept for a film — so requiring it
  // unconditionally meant every movie failed this check and re-hit TMDB on every
  // single request, which is the opposite of what the check is for. Certification
  // and status are excluded outright: plenty of legitimate titles have no
  // certification in the configured region, and treating a genuine null as
  // incomplete puts those rows into the same permanent refetch loop.
  const isDetailComplete =
    existing != null &&
    existing.runtime != null &&
    existing.releaseDate != null &&
    (existing.type !== "series" || existing.network != null) &&
    (existing.imdbRating != null || existing.rtScore != null || existing.mcScore != null);

  if (isDetailComplete) {
    return { ...existing, poster: withRpdbPoster(imdbId, existing.poster, rpdbKey) };
  }

  const metadata = await fetchMetadata(type, imdbId);
  if (!metadata) return null;

  const fresh = await prisma.metadata.findUnique({ where: { imdbId_type: { imdbId, type } } });
  return fresh
    ? { ...fresh, poster: withRpdbPoster(imdbId, fresh.poster, rpdbKey) }
    : { ...metadata, poster: withRpdbPoster(imdbId, metadata.poster, rpdbKey) };
}

export { EMPTY_PROVIDERS };
