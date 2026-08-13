// The api↔addon response contracts.
//
// The addon service is an HTTP client of the API, and every shape that crosses
// that boundary used to be retyped by hand on the addon side and asserted into
// existence with `response.json() as T`. A field the API renamed therefore
// surfaced as an empty Stremio row, days later, with nothing in the logs.
//
// So the shapes live here once, the API's own handlers are annotated with them
// (a rename fails `pnpm typecheck` rather than production), and the addon runs
// the matching parser at the boundary so a mismatch that does get through is a
// loud, named error instead of `undefined` propagating into a catalog.
//
// Parsers normalise: they return only the fields declared here, so nothing can
// come to depend on a field that was never validated. They validate what the
// addon actually reads and stay tolerant of everything else — this is a
// boundary check, not a schema for the whole API.

import type { StremioCatalogType } from "./catalogs.js";

export class ApiContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiContractError";
  }
}

const fail = (detail: string): never => {
  throw new ApiContractError(detail);
};

const asObject = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asArray = (value: unknown, what: string): unknown[] =>
  Array.isArray(value) ? value : fail(`${what} must be an array`);

const asString = (value: unknown, what: string): string =>
  typeof value === "string" ? value : fail(`${what} must be a string`);

const optionalString = (value: unknown, what: string): string | undefined =>
  value === undefined || value === null ? undefined : asString(value, what);

const optionalNumber = (value: unknown, what: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : fail(`${what} must be a number`);
};

const nullableString = (value: unknown, what: string): string | null =>
  value === undefined || value === null ? null : asString(value, what);

const nullableNumber = (value: unknown, what: string): number | null => {
  if (value === undefined || value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : fail(`${what} must be a number`);
};

const optionalStringArray = (value: unknown, what: string): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  return asArray(value, what).map((entry, index) => asString(entry, `${what}[${index}]`));
};

const asCatalogType = (value: unknown, what: string): StremioCatalogType =>
  value === "movie" || value === "series" ? value : fail(`${what} must be "movie" or "series"`);

// ─── Catalog rows ───

/**
 * A catalog row as the API produces it. This is the API's own DTO, not the
 * Stremio wire shape — the addon adds `posterShape` and drops what Stremio has
 * no field for before answering a client.
 */
export type CataloggyMetaPreview = {
  id: string;
  type: StremioCatalogType;
  name: string;
  poster?: string;
  year?: number;
  description?: string;
  genres?: string[];
  rating?: number;
};

export type MetasResponse = { metas: CataloggyMetaPreview[] };

export const parseMetasResponse = (value: unknown): MetasResponse => {
  const body = asObject(value, "response");
  const metas = asArray(body.metas, "metas").map((entry, index) => {
    const meta = asObject(entry, `metas[${index}]`);
    return {
      id: asString(meta.id, `metas[${index}].id`),
      type: asCatalogType(meta.type, `metas[${index}].type`),
      name: asString(meta.name, `metas[${index}].name`),
      poster: optionalString(meta.poster, `metas[${index}].poster`),
      year: optionalNumber(meta.year, `metas[${index}].year`),
      description: optionalString(meta.description, `metas[${index}].description`),
      genres: optionalStringArray(meta.genres, `metas[${index}].genres`),
      rating: optionalNumber(meta.rating, `metas[${index}].rating`),
    };
  });
  return { metas };
};

// ─── Lists ───

export type CataloggyListKind = "watchlist" | "custom" | "collection";

export type CataloggyList = {
  id: string;
  name: string;
  kind: CataloggyListKind;
};

/** `GET /lists`. `createdAt` is a Date on the wire-producing side. */
export type ListsResponse = {
  lists: (CataloggyList & { createdAt?: string | Date; itemCount?: number })[];
};

const asListKind = (value: unknown, what: string): CataloggyListKind =>
  value === "watchlist" || value === "custom" || value === "collection"
    ? value
    : fail(`${what} must be one of: watchlist, custom, collection`);

export const parseListsResponse = (value: unknown): { lists: CataloggyList[] } => {
  const body = asObject(value, "response");
  const lists = asArray(body.lists ?? [], "lists").map((entry, index) => {
    const list = asObject(entry, `lists[${index}]`);
    return {
      id: asString(list.id, `lists[${index}].id`),
      name: asString(list.name, `lists[${index}].name`),
      kind: asListKind(list.kind, `lists[${index}].kind`),
    };
  });
  return { lists };
};

export type CataloggyListItem = {
  imdbId: string;
  type: string;
  /** Title captured when the item was added — stands in until the metadata row lands. */
  title: string | null;
  metadata: {
    name: string;
    poster: string | null;
    year: number | null;
    genres?: string[];
    rating?: number | null;
  } | null;
};

export type ListItemsResponse = { items: CataloggyListItem[] };

export const parseListItemsResponse = (value: unknown): ListItemsResponse => {
  const body = asObject(value, "response");
  const items = asArray(body.items ?? [], "items").map((entry, index) => {
    const item = asObject(entry, `items[${index}]`);
    const rawMetadata = item.metadata;
    const metadata =
      rawMetadata === undefined || rawMetadata === null
        ? null
        : (() => {
            const meta = asObject(rawMetadata, `items[${index}].metadata`);
            return {
              name: asString(meta.name, `items[${index}].metadata.name`),
              poster: nullableString(meta.poster, `items[${index}].metadata.poster`),
              year: nullableNumber(meta.year, `items[${index}].metadata.year`),
              genres: optionalStringArray(meta.genres, `items[${index}].metadata.genres`),
              rating: nullableNumber(meta.rating, `items[${index}].metadata.rating`),
            };
          })();
    return {
      imdbId: asString(item.imdbId, `items[${index}].imdbId`),
      type: asString(item.type, `items[${index}].type`),
      title: nullableString(item.title, `items[${index}].title`),
      metadata,
    };
  });
  return { items };
};

// ─── Genres ───

export type GenresResponse = { genres: string[] };

export const parseGenresResponse = (value: unknown): GenresResponse => {
  const body = asObject(value, "response");
  return { genres: asArray(body.genres, "genres").map((g, i) => asString(g, `genres[${i}]`)) };
};

// ─── Profiles ───

export type ProfilesResponse = { profiles: { id: string; name?: string; hasPin?: boolean }[] };

export const parseProfilesResponse = (value: unknown): { profiles: { id: string }[] } => {
  const body = asObject(value, "response");
  const profiles = asArray(body.profiles ?? [], "profiles").map((entry, index) => ({
    id: asString(asObject(entry, `profiles[${index}]`).id, `profiles[${index}].id`),
  }));
  return { profiles };
};

// ─── Addon config ───

export type AddonConfig = { enabledCatalogs: string[] };

/**
 * `GET /addon/config`. `aiConfigured` rides along because the addon needs it to
 * build a manifest and the alternative was a second round trip per manifest.
 */
export type AddonConfigResponse = {
  config: AddonConfig;
  availableCatalogs: { id: string; label: string; requiresAi: boolean }[];
  availableLists: { id: string; name: string }[];
  aiConfigured: boolean;
  stremioManifestPath: string | null;
  stremioManifestUrl: string | null;
};

export type AddonManifestConfig = { enabledCatalogs: string[]; aiConfigured: boolean };

export const parseAddonConfigResponse = (value: unknown): AddonManifestConfig => {
  const body = asObject(value, "response");
  const config = asObject(body.config, "config");
  return {
    enabledCatalogs: asArray(config.enabledCatalogs, "config.enabledCatalogs").map((c, i) =>
      asString(c, `config.enabledCatalogs[${i}]`)
    ),
    // Older API builds don't send this. Treating "absent" as false would hide
    // the AI catalogs a user explicitly enabled, so absent means "no opinion" —
    // the API's own filtering already dropped them if AI is unavailable.
    aiConfigured: typeof body.aiConfigured === "boolean" ? body.aiConfigured : true,
  };
};

// ─── RPDB ───

export type RpdbConfigResponse = { enabled: boolean; apiKey: string | null };

export const parseRpdbConfigResponse = (value: unknown): RpdbConfigResponse => {
  const body = asObject(value, "response");
  return {
    enabled: body.enabled === true,
    apiKey: nullableString(body.apiKey, "apiKey"),
  };
};

// ─── Preferences ───

export type PreferencesResponse = { spoilerProtection?: boolean };

export const parsePreferencesResponse = (value: unknown): PreferencesResponse => {
  const body = asObject(value, "response");
  return { spoilerProtection: body.spoilerProtection === true };
};

// ─── Series progress ───

export type SeriesProgressResponse = {
  progress?: {
    lastSeason: number;
    lastEpisode: number;
    totalEpisodes?: number | null;
    watchedEpisodes?: number | null;
  };
};

export const parseSeriesProgressResponse = (value: unknown): SeriesProgressResponse => {
  const body = asObject(value, "response");
  if (body.progress === undefined || body.progress === null) return {};
  const progress = asObject(body.progress, "progress");
  return {
    progress: {
      lastSeason: optionalNumber(progress.lastSeason, "progress.lastSeason") ?? 0,
      lastEpisode: optionalNumber(progress.lastEpisode, "progress.lastEpisode") ?? 0,
      totalEpisodes: nullableNumber(progress.totalEpisodes, "progress.totalEpisodes"),
      watchedEpisodes: nullableNumber(progress.watchedEpisodes, "progress.watchedEpisodes"),
    },
  };
};
