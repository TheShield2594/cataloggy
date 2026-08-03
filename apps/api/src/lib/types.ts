import type { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

export type StremioMetaType = "movie" | "series";

export type StremioMetaPreview = {
  id: string;
  type: StremioMetaType;
  name: string;
  poster?: string;
  year?: number;
  description?: string;
  genres?: string[];
  rating?: number;
};

export type ContinueMetaPreview = StremioMetaPreview & {
  extension: {
    season: number;
    episode: number;
  };
  lastWatched: {
    season: number;
    episode: number;
    lastWatchedAt: string;
  };
};

export type SeriesProgressCandidate = {
  lastSeason: number;
  lastEpisode: number;
  lastWatchedAt: Date;
};

export type CheckInData = {
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId?: string;
  name: string;
  poster?: string;
  background?: string;
  season?: number;
  episode?: number;
  startedAt: string;
  expiresAt?: string;
};

export type AiProviderConfig = {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

export type RecordWatchParams = {
  type: "episode" | "movie";
  imdbId: string;
  seriesImdbId?: string;
  season?: number | null;
  episode?: number | null;
  watchedAt: Date;
  dateUnknown?: boolean;
  note?: string | null;
  source: string;
  /**
   * The profile the event belongs to. Passed explicitly rather than read off the
   * request, so a caller that has no `resolveProfile` hook (the Plex/Jellyfin
   * webhooks) can't silently write an event with no owner — Prisma treats an
   * `undefined` profileId as "no filter" on read and rejects it on create.
   */
  profileId: string;
  log: FastifyBaseLogger;
};

// Re-exported so existing `../lib/types.js` imports keep working; the pattern
// itself lives in @cataloggy/shared, which the addon service also validates
// profile ids against.
export { UUID_V4_PATTERN } from "@cataloggy/shared";

export const DEFAULT_STREMIO_LIMIT = 50;
export const MAX_STREMIO_LIMIT = 200;

export const getMetadataType = (rawType: string): MetadataType | null => {
  if (rawType === "movie") return "movie" as MetadataType;
  if (rawType === "series") return "series" as MetadataType;
  return null;
};

export const parseMetaType = (rawType: unknown): StremioMetaType | null => {
  if (rawType === "movie" || rawType === "series") return rawType;
  return null;
};

export const parseCatalogLimit = (rawLimit: unknown): number => {
  if (rawLimit === undefined) return DEFAULT_STREMIO_LIMIT;
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_STREMIO_LIMIT;
  return Math.min(parsed, MAX_STREMIO_LIMIT);
};
