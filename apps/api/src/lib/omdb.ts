import { prisma } from "./prisma.js";
import { readSecretKv } from "./secret-store.js";
import { fetchWithPolicy } from "./http.js";
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
  // OMDb's free tier is 1,000 requests a day, so a throttled request is worth
  // re-asking for once the wait it names has passed rather than silently
  // leaving a title without its Rotten Tomatoes and Metacritic scores.
  const res = await fetchWithPolicy(url, {}, { timeoutMs: 8_000, concurrency: 4 });
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
