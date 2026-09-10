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

export type ListItemsResponse = {
  items: CataloggyListItem[];
  /** Opaque cursor for the next page; absent once the list is exhausted, and always absent when the caller asked for no `limit`. */
  nextCursor: string | null;
};

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
  return { items, nextCursor: nullableString(body.nextCursor, "nextCursor") };
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

// ─── The web client's boundary ───
//
// Everything above crosses api↔addon. What follows crosses api↔web, and it is
// there for a sharper reason: self-hosted upgrades are staggered *by design* —
// `CATALOGGY_IMAGE_TAG` exists so a `web` image from one build can run against
// an `api` image from another — so version skew across this boundary is the
// expected case, not the exceptional one.
//
// `apps/web/src/api.ts` returns `response.json() as Promise<T>` for every one
// of its ~90 methods, which is an assertion the runtime never checks. For most
// of them a missing field renders as a blank, and that is survivable. For the
// three shapes below it is not: each is destructured or indexed without a
// guard on a hot path, so an older API answering `{ calendar: [...] }` without
// `airDate` reaches `entry.airDate.split("-")` and throws inside a `.map` —
// which the single global ErrorBoundary turns into a blank page for the whole
// app rather than a broken calendar.
//
// So these three are parsed at the boundary. A mismatch fails the one request
// that hit it, the section shows its own error state, and the rest of the app
// keeps working. The types are also what the API's own handlers are annotated
// with, so a rename fails `pnpm typecheck` rather than production.

/**
 * The array under `key`, defaulting to empty only when the key is *absent*.
 *
 * `body.history ?? []` looks equivalent and is not: it also swallows an
 * explicit `{ "history": null }`, which is a contract violation wearing an
 * empty state. The page would render "nothing watched yet" and be believed. An
 * omitted key is the honest case — a route that has nothing to send may leave
 * it out — so that one still defaults.
 */
const collection = (body: Record<string, unknown>, key: string): unknown =>
  key in body ? body[key] : [];

const asBoolean = (value: unknown, what: string): boolean =>
  typeof value === "boolean" ? value : fail(`${what} must be a boolean`);

const asNumber = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(`${what} must be a number`);

/**
 * `null` where the API sends one and `undefined` where it omits the key
 * entirely are the same absence to every caller, and the web's own types spell
 * that absence `?:`. Normalising to `undefined` keeps the two from having to be
 * told apart at every read site.
 */
const absentAsUndefined = <T>(value: unknown, read: () => T): T | undefined =>
  value === undefined || value === null ? undefined : read();

// ─── Calendar ───

/** One upcoming episode, as `GET /calendar` returns it. */
export type CalendarEntry = {
  seriesImdbId: string;
  seriesName: string;
  poster: string | null;
  season: number;
  episode: number;
  episodeName: string;
  airDate: string;
  overview: string | null;
};

export type CalendarResponse = { calendar: CalendarEntry[] };

/**
 * `airDate` is checked for shape *and* for being a day that exists: every
 * consumer splits it on "-" and feeds the three parts to `new Date(y, m - 1,
 * d)`, and that constructor rolls a nonsense day forward rather than refusing
 * it — "2026-02-30" silently becomes March 2nd, so the episode lands on the
 * wrong row of the calendar with nothing anywhere saying why. A string that is
 * a string but not a date at all is the same failure one step earlier: it
 * produces `Invalid Date`, which formats as the literal text "Invalid Date" on
 * the screen, days from the build that caused it.
 *
 * The round-trip is the check: `Date.UTC` normalises, so a date that survives
 * with its own three numbers intact is one that really exists.
 */
const asAirDate = (value: unknown, what: string): string => {
  const date = asString(value, what);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return fail(`${what} must be a YYYY-MM-DD date, got "${date}"`);
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const real =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  return real ? date : fail(`${what} must be a day that exists, got "${date}"`);
};

export const parseCalendarResponse = (value: unknown): CalendarResponse => {
  const body = asObject(value, "response");
  const calendar = asArray(collection(body, "calendar"), "calendar").map((entry, index) => {
    const at = `calendar[${index}]`;
    const episode = asObject(entry, at);
    return {
      seriesImdbId: asString(episode.seriesImdbId, `${at}.seriesImdbId`),
      seriesName: asString(episode.seriesName, `${at}.seriesName`),
      poster: nullableString(episode.poster, `${at}.poster`),
      season: asNumber(episode.season, `${at}.season`),
      episode: asNumber(episode.episode, `${at}.episode`),
      episodeName: asString(episode.episodeName, `${at}.episodeName`),
      airDate: asAirDate(episode.airDate, `${at}.airDate`),
      overview: nullableString(episode.overview, `${at}.overview`),
    };
  });
  return { calendar };
};

// ─── Series progress ───

/**
 * One in-progress series, as `GET /series/progress` returns it — the row behind
 * every Up Next card.
 *
 * The four season/episode numbers are required: `nextSeason`/`nextEpisode` are
 * what the "Continue · S2 E5" button marks watched, and a card that cannot say
 * which episode it means is worse than a card that is missing. Everything the
 * metadata row supplies can legitimately be absent — a series TMDB has nothing
 * for still has progress worth showing.
 */
export type SeriesProgress = {
  imdbId: string;
  name: string;
  poster?: string;
  background?: string | null;
  lastSeason: number;
  lastEpisode: number;
  nextSeason: number;
  nextEpisode: number;
  totalSeasons?: number | null;
  totalEpisodes?: number | null;
  watchedEpisodes?: number | null;
  /** Episodes in `lastSeason`, null when TMDB has no season data for the show. */
  seasonTotalEpisodes?: number | null;
  /** Episodes watched within `lastSeason`. */
  seasonWatchedEpisodes?: number | null;
};

export type SeriesProgressListResponse = { progress: SeriesProgress[] };

export const parseSeriesProgressListResponse = (value: unknown): SeriesProgressListResponse => {
  const body = asObject(value, "response");
  const progress = asArray(collection(body, "progress"), "progress").map((entry, index) => {
    const at = `progress[${index}]`;
    const row = asObject(entry, at);
    return {
      imdbId: asString(row.imdbId, `${at}.imdbId`),
      name: asString(row.name, `${at}.name`),
      poster: optionalString(row.poster, `${at}.poster`),
      background: nullableString(row.background, `${at}.background`),
      lastSeason: asNumber(row.lastSeason, `${at}.lastSeason`),
      lastEpisode: asNumber(row.lastEpisode, `${at}.lastEpisode`),
      nextSeason: asNumber(row.nextSeason, `${at}.nextSeason`),
      nextEpisode: asNumber(row.nextEpisode, `${at}.nextEpisode`),
      totalSeasons: nullableNumber(row.totalSeasons, `${at}.totalSeasons`),
      totalEpisodes: nullableNumber(row.totalEpisodes, `${at}.totalEpisodes`),
      watchedEpisodes: nullableNumber(row.watchedEpisodes, `${at}.watchedEpisodes`),
      seasonTotalEpisodes: nullableNumber(row.seasonTotalEpisodes, `${at}.seasonTotalEpisodes`),
      seasonWatchedEpisodes: nullableNumber(row.seasonWatchedEpisodes, `${at}.seasonWatchedEpisodes`),
    };
  });
  return { progress };
};

// ─── Watch history ───

/**
 * One logged watch, as `GET /watch/history` returns it.
 *
 * `name` and `poster` come from the metadata row rather than from the event, so
 * both are absent for a title nothing has been fetched for yet — the history
 * page has always rendered around that (`event.name || "this watch"`), while
 * the type it was written against claimed `name: string`.
 */
export type WatchEvent = {
  id: string;
  imdbId: string;
  seriesImdbId?: string;
  type: "movie" | "episode";
  name: string | null;
  poster?: string;
  season?: number;
  episode?: number;
  /** ISO 8601. Meaningless when `dateUnknown` — the row still needs an order. */
  watchedAt: string;
  dateUnknown: boolean;
  /** Free text attached to this watch. Trakt imports carry theirs across. */
  note?: string | null;
};

export type WatchHistoryResponse = { history: WatchEvent[] };

const asWatchType = (value: unknown, what: string): "movie" | "episode" =>
  value === "movie" || value === "episode" ? value : fail(`${what} must be "movie" or "episode"`);

export const parseWatchHistoryResponse = (value: unknown): WatchHistoryResponse => {
  const body = asObject(value, "response");
  const history = asArray(collection(body, "history"), "history").map((entry, index) => {
    const at = `history[${index}]`;
    const event = asObject(entry, at);
    return {
      id: asString(event.id, `${at}.id`),
      imdbId: asString(event.imdbId, `${at}.imdbId`),
      seriesImdbId: optionalString(event.seriesImdbId, `${at}.seriesImdbId`),
      type: asWatchType(event.type, `${at}.type`),
      name: nullableString(event.name, `${at}.name`),
      poster: optionalString(event.poster, `${at}.poster`),
      season: absentAsUndefined(event.season, () => asNumber(event.season, `${at}.season`)),
      episode: absentAsUndefined(event.episode, () => asNumber(event.episode, `${at}.episode`)),
      watchedAt: asString(event.watchedAt, `${at}.watchedAt`),
      // An older API that doesn't send it never had the flag to set, and every
      // row it does send is a dated one.
      dateUnknown: event.dateUnknown === undefined ? false : asBoolean(event.dateUnknown, `${at}.dateUnknown`),
      note: nullableString(event.note, `${at}.note`),
    };
  });
  return { history };
};
