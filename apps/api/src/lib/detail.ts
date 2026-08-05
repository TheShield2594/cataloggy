import type { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";
import { fetchMetadata } from "./metadata.js";
import { getRpdbApiKey, withRpdbPoster } from "./rpdb.js";
import { getRegionSetting } from "./settings.js";
import { castCache, seasonsCache, watchProvidersCache } from "./cache.js";
import { coalesce } from "./coalesce.js";
import type { Credits, SeasonInfo, WatchProviders } from "../tmdb.js";

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

export async function loadCast(
  type: MetadataType,
  imdbId: string,
  log?: FastifyBaseLogger
): Promise<Credits> {
  const cacheKey = `cast:${type}:${imdbId}`;
  const cached = castCache.get(cacheKey);
  if (cached) return cached;

  const tmdbId = await resolveTmdbId(type, imdbId, log);
  if (!tmdbId) return { cast: [], director: null };

  return coalesce(cacheKey, async () => {
    // Another caller may have filled this while we waited on the ID.
    const raced = castCache.get(cacheKey);
    if (raced) return raced;
    try {
      const tmdb = await getTmdb();
      const credits = await tmdb.getCast(type, tmdbId);
      castCache.set(cacheKey, credits);
      return credits;
    } catch {
      return { cast: [], director: null };
    }
  });
}

export async function loadSeasons(imdbId: string, log?: FastifyBaseLogger): Promise<SeasonInfo[]> {
  const cacheKey = `seasons:${imdbId}`;
  const cached = seasonsCache.get(cacheKey);
  if (cached) return cached;

  const tmdbId = await resolveTmdbId("series", imdbId, log);
  if (!tmdbId) return [];

  return coalesce(cacheKey, async () => {
    const raced = seasonsCache.get(cacheKey);
    if (raced) return raced;
    try {
      const tmdb = await getTmdb();
      const seasons = await tmdb.getSeasons(tmdbId);
      seasonsCache.set(cacheKey, seasons);
      return seasons;
    } catch {
      return [];
    }
  });
}

export async function loadProviders(
  type: MetadataType,
  imdbId: string,
  log?: FastifyBaseLogger
): Promise<WatchProviders> {
  const region = await getRegionSetting();
  const cacheKey = `providers:${type}:${imdbId}:${region}`;
  const cached = watchProvidersCache.get(cacheKey);
  if (cached) return cached;

  const tmdbId = await resolveTmdbId(type, imdbId, log);
  if (!tmdbId) return EMPTY_PROVIDERS;

  return coalesce(cacheKey, async () => {
    const raced = watchProvidersCache.get(cacheKey);
    if (raced) return raced;
    try {
      const tmdb = await getTmdb();
      const providers = await tmdb.getWatchProviders(type, tmdbId, region);
      watchProvidersCache.set(cacheKey, providers);
      return providers;
    } catch {
      return EMPTY_PROVIDERS;
    }
  });
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

  // A row that is merely present isn't enough — the detail panel wants runtime,
  // certification, status, network, release date and at least one external
  // rating, and any of those being absent means the row predates a full sync.
  const isDetailComplete =
    existing != null &&
    existing.runtime != null &&
    existing.certification != null &&
    existing.status != null &&
    existing.network != null &&
    existing.releaseDate != null &&
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
