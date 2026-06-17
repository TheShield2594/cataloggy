import { prisma } from "./prisma.js";
import { getTmdb } from "./tmdb-client.js";
import { getOmdbApiKey, fetchOmdbRatings, upsertOmdbRatings } from "./omdb.js";
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
