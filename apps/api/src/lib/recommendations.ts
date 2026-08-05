import type { MetadataType } from "@prisma/client";
import { getTmdb } from "./tmdb-client.js";
import { upsertMetadata } from "./metadata.js";
import { applyRpdbToMetaList, getRpdbApiKey } from "./rpdb.js";
import { trendingCacheGet, trendingCacheSet } from "./cache.js";
import { resolveTmdbId } from "./detail.js";
import type { StremioMetaPreview, StremioMetaType } from "./types.js";

/**
 * "More like this" for one title, shared with the detail-panel bundle route so
 * both go through the same cache entry rather than each filling their own.
 */
export async function loadRecommendations(
  rawType: string,
  type: MetadataType,
  imdbId: string
): Promise<{ metas: StremioMetaPreview[] }> {
  // Keyed on the validated type rather than on whatever the caller spelled, so
  // two requests meaning the same thing share one entry instead of filling two.
  // `rawType` survives only as the StremioMetaType echoed back in each meta.
  const cacheKey = `recs:${type}:${imdbId}`;
  const [cached, rpdbKey] = await Promise.all([
    Promise.resolve(trendingCacheGet(cacheKey)),
    getRpdbApiKey(),
  ]);
  if (cached) return { metas: applyRpdbToMetaList(cached.data, rpdbKey) };

  const tmdbId = await resolveTmdbId(type, imdbId);
  if (!tmdbId) return { metas: [] };
  return getRecommendations(rawType, type, tmdbId, cacheKey);
}

async function getRecommendations(
  rawType: string,
  type: MetadataType,
  tmdbId: number,
  cacheKey: string
) {
  try {
    const tmdb = await getTmdb();
    const results = await tmdb.recommendations(type, tmdbId);
    await Promise.all(results.map((r) => upsertMetadata(r)));
    const metas: StremioMetaPreview[] = results.map((r) => ({
      id: r.imdbId,
      type: rawType as StremioMetaType,
      name: r.name,
      poster: r.poster ?? undefined,
      year: r.year ?? undefined,
      description: r.description ?? undefined,
      genres: r.genres,
      rating: r.rating ?? undefined,
    }));
    trendingCacheSet(cacheKey, { data: metas });
    const rpdbKey = await getRpdbApiKey();
    return { metas: applyRpdbToMetaList(metas, rpdbKey) };
  } catch {
    return { metas: [] };
  }
}
