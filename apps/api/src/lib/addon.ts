import { ListKind } from "@prisma/client";
import {
  DEFAULT_DISCOVERY_CATALOG_IDS,
  DISCOVERY_CATALOG_IDS,
  isDiscoveryCatalogId,
  migrateLegacyCatalogs,
  parseListCatalogId,
} from "@cataloggy/shared";
import type { AddonConfig } from "@cataloggy/shared";
import { prisma } from "./prisma.js";

// One config row per profile, so two profiles can expose different catalogs to
// Stremio (and so the Settings picker only ever names the requesting profile's
// lists). The `addon:config` row this replaced is copied onto the default
// profile by the 20260803160000_per_profile_addon_config migration.
export const addonConfigKey = (profileId: string) => `addon:config:${profileId}`;

export type { AddonConfig };

// The catalog set itself lives in @cataloggy/shared, which the addon service
// builds its manifest from too — one list, so a catalog can't be offered by the
// picker and then silently dropped by whichever service serves it.
export const ALL_ADDON_CATALOGS: readonly string[] = DISCOVERY_CATALOG_IDS;

export const DEFAULT_ADDON_CATALOGS: readonly string[] = DEFAULT_DISCOVERY_CATALOG_IDS;

export { LEGACY_CATALOG_MAP, migrateLegacyCatalogs } from "@cataloggy/shared";

const defaults = (): AddonConfig => ({ enabledCatalogs: [...DEFAULT_ADDON_CATALOGS] });

export const getAddonConfig = async (profileId: string): Promise<AddonConfig> => {
  const row = await prisma.kV.findUnique({ where: { key: addonConfigKey(profileId) } });
  if (!row) return defaults();
  try {
    const parsed = JSON.parse(row.value) as AddonConfig;
    if (!Array.isArray(parsed.enabledCatalogs)) return defaults();
    if (parsed.enabledCatalogs.length === 0) return { enabledCatalogs: [] };

    const migrated = migrateLegacyCatalogs(parsed.enabledCatalogs);
    const listEntries = migrated.filter((c) => parseListCatalogId(c) !== null);
    let validListIds = new Set<string>();
    if (listEntries.length > 0) {
      const customLists = await prisma.list.findMany({
        where: { kind: ListKind.custom, profileId },
        select: { id: true },
      });
      validListIds = new Set(customLists.map((l) => l.id));
    }
    const valid = migrated.filter((c) => {
      const listId = parseListCatalogId(c);
      return listId === null ? isDiscoveryCatalogId(c) : validListIds.has(listId);
    });
    return { enabledCatalogs: valid.length > 0 ? valid : [...DEFAULT_ADDON_CATALOGS] };
  } catch {
    return defaults();
  }
};
