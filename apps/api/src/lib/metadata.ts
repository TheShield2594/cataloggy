import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";
import { getOmdbApiKey, fetchOmdbRatings, upsertOmdbRatings } from "./omdb.js";
import { mapWithConcurrency } from "./concurrency.js";
import { metadataBackfillCooldownCache } from "./cache.js";
import type { MetadataPayload } from "../tmdb.js";
import type { MetadataType } from "@prisma/client";

export const METADATA_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

export const upsertMetadata = async (metadata: MetadataPayload) => {
  const isDetailedPayload =
    metadata.totalSeasons !== null ||
    metadata.totalEpisodes !== null ||
    metadata.runtime !== null ||
    metadata.certification !== null ||
    metadata.status !== null ||
    metadata.network !== null;

  const update: Record<string, unknown> = {
    tmdbId: metadata.tmdbId,
    name: metadata.name,
    year: metadata.year,
    poster: metadata.poster,
    background: metadata.background,
    description: metadata.description,
    genres: metadata.genres,
    rating: metadata.rating,
    voteCount: metadata.voteCount,
  };

  if (isDetailedPayload) {
    update.totalSeasons = metadata.totalSeasons;
    update.totalEpisodes = metadata.totalEpisodes;
    update.runtime = metadata.runtime;
    update.certification = metadata.certification;
    update.status = metadata.status;
    update.network = metadata.network;
    update.releaseDate = metadata.releaseDate;
  }

  return prisma.metadata.upsert({
    where: { imdbId_type: { imdbId: metadata.imdbId, type: metadata.type } },
    create: metadata,
    update,
  });
};

const enrichWithOmdb = async (imdbId: string, type: MetadataType) => {
  try {
    const omdbKey = await getOmdbApiKey();
    if (omdbKey) {
      const omdb = await fetchOmdbRatings(imdbId, omdbKey);
      if (omdb) return upsertOmdbRatings(imdbId, type, omdb);
    }
  } catch { /* best-effort enrichment, ignore failures */ }
  return undefined;
};

export const fetchMetadata = async (
  type: MetadataType,
  imdbId: string
): Promise<MetadataPayload | null> => {
  const tmdb = await getTmdb();
  const metadata = await tmdb.findByImdbId(type, imdbId);

  if (!metadata) return null;

  await upsertMetadata(metadata);
  await enrichWithOmdb(imdbId, type);

  return metadata;
};

export const syncMetadata = async (imdbId: string, type: MetadataType) => {
  const existing = await prisma.metadata.findUnique({
    where: { imdbId_type: { imdbId, type } },
  });

  if (existing && Date.now() - existing.updatedAt.getTime() < METADATA_FRESHNESS_MS) {
    if (
      existing.imdbRating === null &&
      existing.rtScore === null &&
      existing.mcScore === null
    ) {
      const enriched = await enrichWithOmdb(imdbId, type);
      if (enriched) return enriched;
    }
    return existing;
  }

  const tmdb = await getTmdb();
  const payload = await tmdb.findByImdbId(type, imdbId);

  if (!payload) return existing ?? null;

  const row = await upsertMetadata(payload);
  const enriched = await enrichWithOmdb(imdbId, type);

  return enriched ?? row;
};

// The metadata sync on add is fire-and-forget, and Trakt sync adds in bulk, so a
// list can hold items whose metadata row was never written — leaving the UI and
// the Stremio catalog with nothing to show but the raw IMDb ID. Repair those on
// read, but bounded and off the response path: a freshly imported list of a few
// thousand items must not turn one list load into a few thousand TMDB requests.
const BACKFILL_MAX_PER_CALL = 25;
const BACKFILL_CONCURRENCY = 4;

const backfillInFlight = new Set<string>();

type BackfillLogger = { warn: (obj: object, msg: string) => void };

export const backfillMissingMetadata = (
  items: { imdbId: string; type: MetadataType }[],
  log?: BackfillLogger
): void => {
  const pending: { imdbId: string; type: MetadataType; key: string }[] = [];

  for (const item of items) {
    if (pending.length >= BACKFILL_MAX_PER_CALL) break;
    const key = `${item.imdbId}:${item.type}`;
    if (backfillInFlight.has(key) || metadataBackfillCooldownCache.has(key)) continue;
    backfillInFlight.add(key);
    pending.push({ ...item, key });
  }

  if (pending.length === 0) return;

  void mapWithConcurrency(pending, BACKFILL_CONCURRENCY, async (item) => {
    try {
      const row = await syncMetadata(item.imdbId, item.type);
      // No row means TMDB had no match, not a transient failure — hold off before
      // asking again rather than retrying on every subsequent list load.
      if (!row) metadataBackfillCooldownCache.set(item.key, true);
    } catch (err) {
      metadataBackfillCooldownCache.set(item.key, true);
      log?.warn({ imdbId: item.imdbId, type: item.type, err }, "Metadata backfill failed");
    } finally {
      backfillInFlight.delete(item.key);
    }
  });
};
