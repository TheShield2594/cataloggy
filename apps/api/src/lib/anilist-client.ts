import { LRUCache } from "lru-cache";
import { fetchWithPolicy } from "./http.js";

const ANILIST_API_URL = "https://graphql.anilist.co";
const ANILIST_CACHE_TTL_MS = 60 * 60 * 1000;

export type AniListSearchResult = {
  id: number;
  title: string;
  episodes: number | null;
  coverImage: string | null;
};

export type AniListAnimeDetails = {
  id: number;
  title: string;
  episodes: number | null;
  coverImage: string | null;
  format: string | null;
};

const NOT_FOUND = Symbol("anilist-not-found");

const searchCache = new LRUCache<string, AniListSearchResult[]>({ max: 200, ttl: ANILIST_CACHE_TTL_MS });
const byIdCache = new LRUCache<number, AniListAnimeDetails | typeof NOT_FOUND>({ max: 500, ttl: ANILIST_CACHE_TTL_MS });

const titleOf = (title: { english: string | null; romaji: string | null; native: string | null }): string =>
  title.english ?? title.romaji ?? title.native ?? "Unknown";

const query = async <T>(graphqlQuery: string, variables: Record<string, unknown>): Promise<T> => {
  const res = await fetchWithPolicy(
    ANILIST_API_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    },
    {
      timeoutMs: 8_000,
      concurrency: 4,
      // AniList is GraphQL, so every read is a POST — retrying one duplicates
      // nothing. It rate-limits at 90 requests a minute and says so in
      // `Retry-After`, which the shared policy waits out.
      retryMethods: ["POST"],
    }
  );

  if (!res.ok) {
    throw new Error(`AniList request failed with status ${res.status}`);
  }

  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`AniList request failed: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  if (!json.data) {
    throw new Error("AniList request returned no data");
  }
  return json.data;
};

export const searchAnime = async (search: string): Promise<AniListSearchResult[]> => {
  const trimmed = search.trim();
  if (!trimmed) return [];

  const cached = searchCache.get(trimmed);
  if (cached) return cached;

  const data = await query<{
    Page: { media: Array<{ id: number; episodes: number | null; coverImage: { large: string | null }; title: { english: string | null; romaji: string | null; native: string | null } }> };
  }>(
    `query ($search: String) {
      Page(perPage: 10) {
        media(search: $search, type: ANIME) {
          id
          episodes
          coverImage { large }
          title { english romaji native }
        }
      }
    }`,
    { search: trimmed }
  );

  const results = data.Page.media.map((m) => ({
    id: m.id,
    title: titleOf(m.title),
    episodes: m.episodes,
    coverImage: m.coverImage.large,
  }));

  searchCache.set(trimmed, results);
  return results;
};

export const getAnimeById = async (id: number): Promise<AniListAnimeDetails | null> => {
  const cached = byIdCache.get(id);
  if (cached !== undefined) return cached === NOT_FOUND ? null : cached;

  const data = await query<{
    Media: { id: number; episodes: number | null; format: string | null; coverImage: { large: string | null }; title: { english: string | null; romaji: string | null; native: string | null } } | null;
  }>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        episodes
        format
        coverImage { large }
        title { english romaji native }
      }
    }`,
    { id }
  );

  const result = data.Media
    ? {
        id: data.Media.id,
        title: titleOf(data.Media.title),
        episodes: data.Media.episodes,
        coverImage: data.Media.coverImage.large,
        format: data.Media.format,
      }
    : null;

  byIdCache.set(id, result ?? NOT_FOUND);
  return result;
};

/**
 * Maps an AniList anime's total episode count into a flat absolute-episode
 * numbering scheme (1..episodes), independent of TMDB's season/episode split.
 */
export const toAbsoluteEpisodeNumbering = (
  anime: AniListAnimeDetails
): { totalEpisodes: number; absoluteEpisode: (n: number) => number } => {
  const totalEpisodes = anime.episodes ?? 0;
  return {
    totalEpisodes,
    absoluteEpisode: (n: number) => {
      const normalized = Math.max(n, 1);
      return totalEpisodes > 0 ? Math.min(normalized, totalEpisodes) : normalized;
    },
  };
};
