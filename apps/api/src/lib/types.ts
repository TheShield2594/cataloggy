import type { MetadataType } from "@prisma/client";
import type { FastifyRequest } from "fastify";

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
  source: string;
  request: FastifyRequest;
};

export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
