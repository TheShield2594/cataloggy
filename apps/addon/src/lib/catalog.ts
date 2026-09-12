import type { FastifyBaseLogger } from "fastify";
import { getDiscoveryCatalog } from "@cataloggy/shared";
import type { CataloggyListItem } from "@cataloggy/shared";
import {
  applyRpdbToMetas,
  fetchAddonConfig,
  fetchAllLists,
  fetchDiscoveryMetas,
  fetchListItems,
  fetchRpdbConfig,
} from "./cataloggy-data.js";
import { isDiscoveryEnabled, isListEnabled } from "./manifest.js";
import type { StremioMetaPreview } from "./stremio-types.js";

/** Answering "what is in this catalog" — the shared body of both catalog routes. */

export const parseCatalogId = (id: string) => {
  const match = id.match(/^cataloggy-([0-9a-f-]+)-(movie|series)$/i);
  if (!match) return null;
  // Both groups are required by the pattern, so a match has both. The check is
  // what says so to the checker, and keeps saying it if the pattern is edited.
  const [, listId, catalogType] = match;
  if (listId === undefined || catalogType === undefined) return null;
  return { listId, catalogType };
};

export const itemsToMetas = (items: CataloggyListItem[], type: string): StremioMetaPreview[] =>
  items
    // Redundant against a current API, which now filters by type itself, but the
    // addon and the API are separate containers and a rolling update runs one
    // version ahead of the other for a minute or two. Dropping this would put
    // series rows in a movie catalog for exactly that window.
    .filter((item) => item.type === type)
    .map((item) => ({
      id: item.imdbId,
      type: item.type,
      name: item.metadata?.name ?? item.title ?? item.imdbId,
      ...(item.metadata?.poster ? { poster: item.metadata.poster } : {}),
      posterShape: "poster" as const,
      ...(item.metadata?.genres?.length ? { genres: item.metadata.genres } : {}),
    }));

export const parseExtra = (extra: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const pair of extra.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
    }
  }
  return params;
};

const compareNames = (a: StremioMetaPreview, b: StremioMetaPreview): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export const applyExtraFilters = (
  metas: StremioMetaPreview[],
  extraParams: Record<string, string>
): StremioMetaPreview[] => {
  let filtered = metas;

  if (extraParams.search) {
    const query = extraParams.search.toLowerCase();
    filtered = filtered.filter((m) => m.name.toLowerCase().includes(query));
  }

  if (extraParams.genre === "A-Z") {
    return [...filtered].sort(compareNames);
  }
  if (extraParams.genre === "Z-A") {
    return [...filtered].sort((a, b) => compareNames(b, a));
  }

  if (extraParams.genre) {
    const genre = extraParams.genre;
    filtered = filtered.filter((m) => m.genres?.includes(genre));
  }

  return filtered;
};

export const handleCatalog = async (
  type: string,
  id: string,
  profileId: string | null,
  logger: FastifyBaseLogger,
  extra?: string
) => {
  // Check discovery catalogs first
  const discovery = getDiscoveryCatalog(id);
  if (discovery) {
    if (discovery.type !== type) return { metas: [] };

    const [rpdb, config] = await Promise.all([
      fetchRpdbConfig(profileId, logger),
      fetchAddonConfig(profileId, logger),
    ]);
    // A catalog the manifest doesn't advertise is a URL no client should hold,
    // and serving it anyway is how a disabled row keeps appearing.
    if (config && !isDiscoveryEnabled(discovery, config)) return { metas: [] };

    let metas = await fetchDiscoveryMetas(id, profileId, logger);
    if (extra) {
      metas = applyExtraFilters(metas, parseExtra(extra));
    }
    return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
  }

  // User list catalogs
  const parsed = parseCatalogId(id);
  if (!parsed || type !== parsed.catalogType) return { metas: [] };

  // Same rule the manifest applied: a custom list the profile unticked is not a
  // list this URL is entitled to serve.
  const [lists, config] = await Promise.all([fetchAllLists(profileId), fetchAddonConfig(profileId, logger)]);
  const list = lists.find((l) => l.id === parsed.listId);
  if (!list || !isListEnabled(list, config)) return { metas: [] };

  const [items, rpdb] = await Promise.all([
    fetchListItems(parsed.listId, profileId, type),
    fetchRpdbConfig(profileId, logger),
  ]);
  // Default to alphabetical order; Z-A/genre extras (if selected) override below.
  let metas = itemsToMetas(items, type).sort(compareNames);
  if (extra) {
    metas = applyExtraFilters(metas, parseExtra(extra));
  }
  return { metas: applyRpdbToMetas(metas, rpdb.apiKey) };
};
