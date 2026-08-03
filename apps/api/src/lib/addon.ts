import { ListKind } from "@prisma/client";
import { prisma } from "./prisma.js";

// One config row per profile, so two profiles can expose different catalogs to
// Stremio (and so the Settings picker only ever names the requesting profile's
// lists). The `addon:config` row this replaced is copied onto the default
// profile by the 20260803160000_per_profile_addon_config migration.
export const addonConfigKey = (profileId: string) => `addon:config:${profileId}`;

export type AddonConfig = {
  enabledCatalogs: string[];
};

export const ALL_ADDON_CATALOGS = [
  "cataloggy-trending-movie", "cataloggy-trending-series",
  "cataloggy-popular-movie", "cataloggy-popular-series",
  "cataloggy-recommended-movie", "cataloggy-recommended-series",
  "cataloggy-ai-movie", "cataloggy-ai-series",
  "cataloggy-anime-series", "cataloggy-anime-movie",
  "cataloggy-netflix-movie", "cataloggy-netflix-series",
  "cataloggy-disney-movie", "cataloggy-disney-series",
  "cataloggy-amazon-movie", "cataloggy-amazon-series",
  "cataloggy-apple-movie", "cataloggy-apple-series",
  "cataloggy-max-movie", "cataloggy-max-series",
];

export const DEFAULT_ADDON_CATALOGS = [
  "cataloggy-trending-movie", "cataloggy-trending-series",
  "cataloggy-popular-movie", "cataloggy-popular-series",
  "cataloggy-recommended-movie", "cataloggy-recommended-series",
];

export const LEGACY_CATALOG_MAP: Record<string, string> = {
  my_watchlist_movies: "cataloggy-trending-movie",
  my_watchlist_series: "cataloggy-trending-series",
  my_recent_movies: "cataloggy-popular-movie",
  my_continue_series: "cataloggy-popular-series",
};

export const migrateLegacyCatalogs = (catalogs: string[]): string[] =>
  catalogs.map((c) => LEGACY_CATALOG_MAP[c] ?? c);

export const getAddonConfig = async (profileId: string): Promise<AddonConfig> => {
  const row = await prisma.kV.findUnique({ where: { key: addonConfigKey(profileId) } });
  if (!row) return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
  try {
    const parsed = JSON.parse(row.value) as AddonConfig;
    if (!Array.isArray(parsed.enabledCatalogs)) return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
    if (parsed.enabledCatalogs.length === 0) return { enabledCatalogs: [] };

    const migrated = migrateLegacyCatalogs(parsed.enabledCatalogs);
    const listEntries = migrated.filter((c) => c.startsWith("list:"));
    let validListIds = new Set<string>();
    if (listEntries.length > 0) {
      const customLists = await prisma.list.findMany({
        where: { kind: ListKind.custom, profileId },
        select: { id: true },
      });
      validListIds = new Set(customLists.map((l) => l.id));
    }
    const valid = migrated.filter(
      (c) =>
        ALL_ADDON_CATALOGS.includes(c) ||
        (c.startsWith("list:") && validListIds.has(c.slice(5)))
    );
    return { enabledCatalogs: valid.length > 0 ? valid : DEFAULT_ADDON_CATALOGS };
  } catch {
    return { enabledCatalogs: DEFAULT_ADDON_CATALOGS };
  }
};
