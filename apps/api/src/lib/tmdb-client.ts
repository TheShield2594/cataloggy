import { TmdbClient } from "../tmdb.js";
import { prisma } from "./prisma.js";
import { getLanguageSetting } from "./settings.js";

export const TMDB_API_KEY_KV = "tmdb:apiKey";

/** Where the key in use came from, or null when there is none. */
export type TmdbKeySource = "db" | "env" | null;

/**
 * A key saved from Settings wins over `TMDB_API_KEY`, so a self-hoster can
 * correct or rotate a key without editing their compose file and restarting;
 * the environment variable stays supported as the way to seed a deployment.
 */
export const getTmdbApiKey = async (): Promise<{ apiKey: string | null; source: TmdbKeySource }> => {
  const row = await prisma.kV.findUnique({ where: { key: TMDB_API_KEY_KV } });
  const stored = row?.value?.trim();
  if (stored) return { apiKey: stored, source: "db" };

  const fromEnv = process.env.TMDB_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  return { apiKey: null, source: null };
};

export const getTmdb = async (): Promise<TmdbClient> => {
  const [lang, { apiKey }] = await Promise.all([getLanguageSetting(), getTmdbApiKey()]);
  if (!apiKey) {
    throw new Error("TMDB_API_KEY is not configured");
  }

  return TmdbClient.fromKey(apiKey, lang);
};
