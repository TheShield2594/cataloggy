import {
  catalogRequiresAi,
  DISCOVERY_CATALOGS,
  listCatalogId,
  selectDiscoveryCatalogs,
} from "@cataloggy/shared";
import type { AddonManifestConfig, CataloggyList, DiscoveryCatalog } from "@cataloggy/shared";
import { WEB_PUBLIC_BASE } from "./config.js";

/** The manifest Stremio installs, and the rules about what appears in it. */

// Stremio's UI only renders a filter dropdown for the "genre" extra, so
// alphabetical sorting (which Stremio has no native concept of) is exposed
// as pseudo-genre options alongside the real content genres.
const SORT_OPTIONS = ["A-Z", "Z-A"];

// The Settings picker only offers custom lists, so only custom lists are gated
// on the config. The watchlist and the collection are core rows with no
// checkbox anywhere — gating them would remove them with no way to bring them
// back. Unticking a custom list in Settings now removes it here too, which is
// what the picker has always claimed it does.
export const isListEnabled = (list: CataloggyList, config: AddonManifestConfig | null): boolean => {
  if (list.kind !== "custom") return true;
  if (!config) return true;
  return config.enabledCatalogs.includes(listCatalogId(list.id));
};

export const isDiscoveryEnabled = (catalog: DiscoveryCatalog, config: AddonManifestConfig): boolean =>
  selectDiscoveryCatalogs(config.enabledCatalogs, { aiConfigured: config.aiConfigured }).some(
    (c) => c.id === catalog.id
  );

export const buildManifest = (lists: CataloggyList[], genres: string[], config: AddonManifestConfig | null) => {
  const genreExtra = [{ name: "genre", options: [...SORT_OPTIONS, ...genres], isRequired: false }];

  const listCatalogs = lists
    .filter((list) => isListEnabled(list, config))
    .flatMap((list) => [
      {
        type: "movie" as const,
        id: `cataloggy-${list.id}-movie`,
        name: list.name,
        extra: [
          { name: "search", isRequired: false },
          ...genreExtra,
        ]
      },
      {
        type: "series" as const,
        id: `cataloggy-${list.id}-series`,
        name: list.name,
        extra: [
          { name: "search", isRequired: false },
          ...genreExtra,
        ]
      }
    ]);

  // No config and nothing cached means the API is unreachable. Emptying a
  // Stremio home screen over a blip is worse than showing a superset, so the
  // degraded manifest advertises everything the profile could have enabled —
  // minus the AI catalogs, whose provider we have no way to check for.
  const selected = config
    ? selectDiscoveryCatalogs(config.enabledCatalogs, { aiConfigured: config.aiConfigured })
    : DISCOVERY_CATALOGS.filter((catalog) => !catalogRequiresAi(catalog));

  const discoveryCatalogs = selected.map((catalog) => ({
    type: catalog.type,
    id: catalog.id,
    name: catalog.label,
    extra: [
      { name: "search", isRequired: false },
      ...genreExtra,
    ],
  }));

  const catalogs = [...listCatalogs, ...discoveryCatalogs];

  const configUrl = WEB_PUBLIC_BASE ? `${WEB_PUBLIC_BASE}/settings` : undefined;

  return {
    id: "com.cataloggy.addon",
    version: "0.3.0",
    name: "Cataloggy",
    description: "Personal catalogs, tracking, and discovery powered by Cataloggy.",
    // Stremio fetches this itself, so it can only be offered once the web UI
    // has a public address; without one the addon keeps Stremio's generic tile.
    ...(WEB_PUBLIC_BASE ? { logo: `${WEB_PUBLIC_BASE}/icons/icon-192.png` } : {}),
    // `stream` is declared without Cataloggy ever providing a stream: the
    // request itself is the point. A client asks every installed addon for
    // streams the moment a user opens a title to watch it, and that request is
    // the only "about to play this" signal the protocol offers an addon that
    // isn't a stream provider. The reply is always an empty list, so nothing
    // extra appears in the client. See `lib/play-signal.ts`.
    resources: ["catalog", "meta", "subtitles", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs,
    ...(configUrl ? {
      behaviorHints: { configurable: true, configurationRequired: false },
    } : {}),
  };
};
