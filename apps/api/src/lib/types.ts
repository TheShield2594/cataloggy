import type { MetadataType } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { CataloggyMetaPreview, StremioCatalogType } from "@cataloggy/shared";

// Both aliases of the api↔addon contract in @cataloggy/shared: this is the
// shape the addon service parses off the wire, so a change made here has to be
// a change made there — which is the point.
export type StremioMetaType = StremioCatalogType;

export type StremioMetaPreview = CataloggyMetaPreview;

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

// The optional fields below are `?: T | undefined` rather than `?: T`: every
// caller builds these from values that are themselves optional and passes them
// straight through, and nothing downstream tells a missing key from an
// undefined one. `exactOptionalPropertyTypes` is left to bite where the
// distinction is real — a Prisma `data`/`where`, a `fetch` init.
export type CheckInData = {
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId?: string | undefined;
  name: string;
  poster?: string | undefined;
  background?: string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  startedAt: string;
  expiresAt?: string | undefined;
};

export type AiProviderConfig = {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
};

export type RecordWatchParams = {
  type: "episode" | "movie";
  imdbId: string;
  seriesImdbId?: string | undefined;
  season?: number | null | undefined;
  episode?: number | null | undefined;
  watchedAt: Date;
  dateUnknown?: boolean | undefined;
  note?: string | null | undefined;
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
