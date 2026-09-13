/**
 * Every shape the API answers with, and the shapes it takes.
 *
 * One module rather than one per domain: these are the vocabulary the whole
 * app speaks, several of them appear in more than one domain's calls, and a
 * type has no behaviour to split along. What was worth splitting is the 102
 * methods that used to sit under them in the same file — those are now
 * `api/lists.ts`, `api/watch.ts` and the rest.
 */

/**
 * The three response shapes this client validates rather than asserts, defined
 * once in `@cataloggy/shared` and annotated onto the API's own handlers — see
 * the "web client's boundary" section of `packages/shared/src/api-contracts.ts`
 * for why these three and not the other ~87.
 */
export type { CalendarEntry, SeriesProgress, WatchEvent } from "@cataloggy/shared/contracts";

export type MediaType = "movie" | "series";

/*
 * Optional properties in this file are spelled `?: T | undefined`.
 *
 * These types describe what the API sends after parsing, and the parsers set
 * the key either way — `{ poster: undefined }`, not `{}` — so under
 * `exactOptionalPropertyTypes` the annotation has to say that undefined is one
 * of the values, not only that the key may be missing. `SearchResult` below has
 * always said as much in prose: "undefined = not yet fetched".
 */

export type SearchResult = {
  imdbId: string;
  type: MediaType;
  name: string;
  year: number | null;
  poster: string | null;
  description: string | null;
  genres: string[];
  rating: number | null;
  inWatchlist: boolean;
  inCollection: boolean;
  lists: string[];
  // OMDB ratings — undefined = not yet fetched, null = fetched but unavailable
  imdbRating?: number | null | undefined;
  rtScore?: number | null | undefined;
  mcScore?: number | null | undefined;
  // Detail fields — undefined = not yet fetched
  runtime?: number | null | undefined;
  certification?: string | null | undefined;
  status?: string | null | undefined;
  network?: string | null | undefined;
  releaseDate?: string | null | undefined;
  tmdbId?: number | null | undefined;
  background?: string | null | undefined;
};

export type ListItem = {
  listId: string;
  type: MediaType;
  imdbId: string;
  addedAt: string;
};

export type ListItemWithMeta = ListItem & {
  // Title captured when the item was added — stands in until the metadata row lands.
  title?: string | null | undefined;
  metadata: { name: string; poster: string | null; year: number | null; genres: string[]; rating: number | null } | null;
};

export type CatalogList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom" | "collection";
  itemCount: number;
};

export type CatalogMeta = {
  id: string;
  type: MediaType;
  name: string;
  poster?: string | undefined;
  year?: number | undefined;
  description?: string | undefined;
};

export type WatchStats = {
  totalMovies: number;
  totalEpisodes: number;
  totalPlays: number;
  playsThisWeek: number;
};

export type DetailedWatchStats = {
  monthly: { month: string; movies: number; episodes: number }[];
  genreDistribution: { genre: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  topRated: { imdbId: string; name: string; type: string; rating: number | null; poster: string | null }[];
};

export type YearInReviewStats = {
  year: number;
  totalMovies: number;
  totalEpisodes: number;
  totalRuntimeMinutes: number;
  topGenres: { genre: string; count: number }[];
  topRated: { imdbId: string; name: string | null; type: string; rating: number; poster: string | null }[];
  busiestMonth: number | null;
  busiestMonthCount: number;
};

export type AddonConfig = {
  enabledCatalogs: string[];
};

// Labelled by the API from the shared catalog registry, so the picker can't
// name a catalog differently from the manifest that serves it — or offer one no
// manifest has heard of.
export type AddonCatalogOption = {
  id: string;
  label: string;
  requiresAi: boolean;
};

export type StremioLibraryStatus = {
  connected: boolean;
  email: string | null;
  apiBase: string | null;
  connectedAt: string | null;
};

export type StremioSyncSummary = {
  scanned: number;
  fetched: number;
  recorded: number;
  skipped: number;
};

export type NotificationChannelKind = "ntfy" | "gotify" | "discord" | "webhook";

export type NotificationChannel = {
  id: string;
  kind: NotificationChannelKind;
  name: string;
  url: string;
  /** The token itself is write-only — the API never sends it back. */
  hasToken: boolean;
  enabled: boolean;
  createdAt: string;
};

/**
 * How a "test this target" call failed. Both endpoints are allowed to point at
 * the LAN, so they answer with one of these verdicts rather than a status code
 * or a socket error, which would let a token holder scan the network by
 * reading the replies. `error` carries the wording for the user; the detail is
 * in the server log.
 */
export type OutboundFailure = "blocked" | "misconfigured" | "unreachable" | "rejected" | "failed";

export type JellyseerrConfig = {
  url: string;
  /** Whether a watchlist add becomes a request on the server. */
  requestOnAdd: boolean;
  /** Whether un-listing cancels a request nobody has approved yet. */
  cancelOnRemove: boolean;
  /** The key itself is write-only — the API never sends it back. */
  hasApiKey: boolean;
};

export type JellyseerrStatus = { configured: boolean; config: JellyseerrConfig | null };

export type PlaySignal = {
  id: string;
  type: "movie" | "episode";
  imdbId: string;
  season: number | null;
  episode: number | null;
  resource: "stream" | "subtitles";
  client: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  dueAt: string;
};

export type TrendingMeta = {
  id: string;
  type: MediaType;
  name: string;
  poster?: string | undefined;
  year?: number | undefined;
  description?: string | undefined;
  genres?: string[] | undefined;
  rating?: number | undefined;
};

/**
 * What a rating can be about. Wider than `MediaType` because a series can be
 * rated as a whole, season by season, or episode by episode — `season` and
 * `episode` ratings carry the numbers that locate them, keyed by the series'
 * IMDb id.
 */
export type RatingType = MediaType | "season" | "episode";

/** Locates a season or episode rating; omitted entirely for movies and series. */
export type RatingTarget = { season?: number | undefined; episode?: number | undefined };

export type UserRating = {
  imdbId: string;
  type: RatingType;
  season?: number | undefined;
  episode?: number | undefined;
  rating: number;
  ratedAt: string;
};

export type UserPreferences = {
  language: string;
  region: string;
  spoilerProtection: boolean;
};

export type CheckIn = {
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId?: string | undefined;
  name: string;
  poster?: string | undefined;
  background?: string | undefined;
  season?: number | undefined;
  episode?: number | undefined;
  startedAt: string;
  expiresAt?: string | undefined;
};

export type WatchProvider = {
  id: number;
  name: string;
  logo: string | null;
};

/** The metadata row behind a title, as `/meta/:type/:imdbId` returns it. */
export type ItemMeta = {
  imdbId: string; type: string; name: string; year: number | null; poster: string | null;
  description: string | null; genres: string[]; rating: number | null;
  imdbRating: number | null; rtScore: number | null; mcScore: number | null;
  runtime: number | null; certification: string | null;
  status: string | null; network: string | null; releaseDate: string | null;
  tmdbId: number | null; background: string | null;
};

export type CastMemberInfo = {
  name: string; character: string; photo: string | null; order: number;
};

export type SeasonSummary = {
  seasonNumber: number; name: string; episodeCount: number; airYear: number | null; poster: string | null;
};

export type WatchProviders = {
  link: string | null;
  flatrate: WatchProvider[];
  free: WatchProvider[];
  ads: WatchProvider[];
};

/** Everything the detail panel opens with, as `/meta/:type/:imdbId/bundle` returns it. */
export type DetailBundle = {
  meta: ItemMeta;
  cast: CastMemberInfo[];
  director: string | null;
  providers: WatchProviders;
  recommendations: TrendingMeta[];
  seasons: SeasonSummary[];
  dropped: boolean;
};

export type EpisodeInfo = {
  episodeNumber: number;
  name: string;
  airDate: string | null;
  still: string | null;
  runtime: number | null;
};

export type WatchedEpisode = {
  season: number;
  episode: number;
};

export type ItemListMembership = {
  listId: string;
  listName: string;
  listKind: string;
  type: string;
  addedAt: string;
};

export type Profile = {
  id: string;
  name: string;
  hasPin: boolean;
};

export type ScrobbleSession = {
  id: string;
  type: "movie" | "episode";
  imdbId: string;
  seriesImdbId: string | null;
  season: number | null;
  episode: number | null;
  status: "playing" | "paused" | "stopped";
  progress: number;
  startedAt: string;
  updatedAt: string;
  name: string | null;
  poster: string | null;
};

export type ExportPayload = {
  version: number;
  exportedAt: string;
  profile: { name: string };
  lists: Array<{
    name: string;
    kind: "watchlist" | "custom" | "collection";
    items: Array<{ type: "movie" | "series"; imdbId: string; addedAt: string }>;
  }>;
  watchEvents: Array<{
    type: "movie" | "episode";
    imdbId: string;
    seriesImdbId: string | null;
    season: number | null;
    episode: number | null;
    watchedAt: string;
    plays: number;
  }>;
  seriesProgress: Array<{
    seriesImdbId: string;
    lastSeason: number;
    lastEpisode: number;
    lastWatchedAt: string;
  }>;
  ratings: Array<{ imdbId: string; type: string; rating: number; ratedAt: string }>;
};

export type ImportSummary = {
  lists: number;
  listItems: number;
  watchEvents: number;
  seriesProgress: number;
  ratings: number;
};

export type GameSort = "recent" | "playtime" | "rating";

export type Game = {
  id: string;
  igdbId: number | null;
  steamAppId: number | null;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  genres: string[];
  playtimeMinutes: number;
  lastPlayedAt: string | null;
  rating: number | null;
  notes: string | null;
  finished: boolean;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GameSearchResult = {
  igdbId: number;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  genres: string[];
  inLibrary: boolean;
};

export type SteamPlayerSummary = {
  steamId: string;
  username: string;
  avatar: string | null;
  profileUrl: string | null;
};

export type SteamStatus = {
  configured: boolean;
  player: SteamPlayerSummary | null;
};

/**
 * Whether the server has IGDB credentials. Game *search* is the only thing that
 * needs them, so `GET /games` cannot answer this — an empty library reads the
 * same either way.
 */

export type IgdbStatus = {
  configured: boolean;
};


export type SteamSyncSummary = {
  total: number;
  created: number;
  updated: number;
  matched: number;
  unmatched: number;
};

export type JobFailure = {
  job: string;
  message: string;
  failedAt: string;
};

/** The last run of a scheduled job, whether or not it failed. */
export type JobRun = {
  job: string;
  status: "ok" | "failed";
  message: string | null;
  durationMs: number | null;
  /** Ran past its own interval, so the tick that followed was dropped. */
  overran: boolean;
  at: string;
};

/** `source` says which key is in use: one saved here, or `TMDB_API_KEY`. */
export type TmdbStatus = {
  configured: boolean;
  source: "db" | "env" | null;
};
