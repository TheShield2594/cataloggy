import { prisma } from "./prisma.js";
import type { StremioMetaPreview } from "./types.js";

const RPDB_API_KEY_KV = "rpdb:apiKey";
export const RPDB_BASE_URL = "https://api.ratingposterdb.com";

export const getRpdbApiKey = async (): Promise<string | null> => {
  const row = await prisma.kV.findUnique({ where: { key: RPDB_API_KEY_KV } });
  return row?.value?.trim() || null;
};

export const buildRpdbPosterUrl = (rpdbKey: string, imdbId: string): string =>
  `${RPDB_BASE_URL}/${encodeURIComponent(rpdbKey)}/imdb/poster-default/${encodeURIComponent(imdbId)}.jpg`;

export const withRpdbPoster = (
  imdbId: string,
  fallback: string | null | undefined,
  rpdbKey: string | null
): string | null => (rpdbKey ? buildRpdbPosterUrl(rpdbKey, imdbId) : (fallback ?? null));

export const applyRpdbToMetaList = (
  metas: StremioMetaPreview[],
  rpdbKey: string | null
): StremioMetaPreview[] => {
  if (!rpdbKey) return metas;
  return metas.map((m) => ({ ...m, poster: buildRpdbPosterUrl(rpdbKey, m.id) }));
};

export { RPDB_API_KEY_KV };
