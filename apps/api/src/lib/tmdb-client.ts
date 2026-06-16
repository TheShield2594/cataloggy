import { TmdbClient } from "../tmdb.js";
import { getLanguageSetting } from "./settings.js";

export const getTmdb = async (): Promise<TmdbClient> => {
  const lang = await getLanguageSetting();
  return TmdbClient.fromEnv(lang);
};
