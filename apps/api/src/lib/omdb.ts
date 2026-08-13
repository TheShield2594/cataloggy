import { prisma } from "./prisma.js";
import { readSecretKv } from "./secret-store.js";
import type { MetadataType } from "@prisma/client";

export const OMDB_API_KEY_KV = "omdb:apiKey";

export const getOmdbApiKey = async (): Promise<string | null> => {
  const stored = await readSecretKv(OMDB_API_KEY_KV);
  return stored?.trim() || null;
};

export type OmdbRatings = {
  imdbRating: number | null;
  rtScore: number | null;
  mcScore: number | null;
};

export const fetchOmdbRatings = async (imdbId: string, apiKey: string): Promise<OmdbRatings | null> => {
  const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json() as {
    Response?: string;
    imdbRating?: string;
    Ratings?: Array<{ Source: string; Value: string }>;
  };
  if (data.Response !== "True") return null;

  const rawImdb = data.imdbRating && data.imdbRating !== "N/A" ? parseFloat(data.imdbRating) : NaN;
  const imdbRating = isNaN(rawImdb) ? null : rawImdb;

  const rtValue = data.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value;
  const rawRt = rtValue ? parseInt(rtValue.replace("%", ""), 10) : NaN;
  const rtScore = isNaN(rawRt) ? null : rawRt;

  const mcValue = data.Ratings?.find((r) => r.Source === "Metacritic")?.Value;
  const rawMc = mcValue ? parseInt(mcValue.split("/")[0], 10) : NaN;
  const mcScore = isNaN(rawMc) ? null : rawMc;

  return { imdbRating, rtScore, mcScore };
};

export const upsertOmdbRatings = async (imdbId: string, type: MetadataType, ratings: OmdbRatings) => {
  return prisma.metadata.update({
    where: { imdbId_type: { imdbId, type } },
    data: { imdbRating: ratings.imdbRating, rtScore: ratings.rtScore, mcScore: ratings.mcScore },
  });
};
