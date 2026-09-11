import { readKv, writeKv } from "./kv.js";

export const LANGUAGE_KV_KEY = "settings:language";
export const REGION_KV_KEY = "settings:region";
export const SPOILER_PROTECTION_KV_KEY = "settings:spoilerProtection";

export const getLanguageSetting = async (): Promise<string> => (await readKv(LANGUAGE_KV_KEY)) ?? "en-US";

export const getRegionSetting = async (): Promise<string> => (await readKv(REGION_KV_KEY)) ?? "US";

export const getSpoilerProtection = async (): Promise<boolean> =>
  (await readKv(SPOILER_PROTECTION_KV_KEY)) === "true";

// Paired with the getters above rather than left as upserts at the call site,
// so that the write and the cache invalidation it needs cannot drift apart —
// the same argument `lib/secret-store.ts` makes for the credential keys.

export const setLanguageSetting = (language: string): Promise<void> => writeKv(LANGUAGE_KV_KEY, language);

export const setRegionSetting = (region: string): Promise<void> => writeKv(REGION_KV_KEY, region);

export const setSpoilerProtection = (enabled: boolean): Promise<void> =>
  writeKv(SPOILER_PROTECTION_KV_KEY, String(enabled));
