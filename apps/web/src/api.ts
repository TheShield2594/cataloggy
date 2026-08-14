import {
  invalidate as invalidateCachePrefix,
  invalidateAll as invalidateMemoryCache,
  setCacheScope,
} from "./utils/dataCache";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

declare global {
  interface Window {
    __CATALOGGY_API_BASE__?: string;
    __CATALOGGY_ADDON_BASE__?: string;
  }
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const API_BASE_DEFAULT = stripTrailingSlash(
  window.__CATALOGGY_API_BASE__ || import.meta.env.VITE_API_BASE || "http://localhost:7000"
);
// Base URL of the dedicated apps/addon service (the full-featured Stremio
// addon with meta/subtitles/search/genre support) — distinct from the API
// server above, which only hosts a thinner catalog-only manifest.
const ADDON_BASE_DEFAULT = stripTrailingSlash(
  window.__CATALOGGY_ADDON_BASE__ || import.meta.env.VITE_ADDON_BASE || "http://localhost:7001"
);
const API_BASE_OVERRIDE_KEY = "cataloggy_api_base_override";
const TOKEN_KEY = "cataloggy_token";
const PROFILE_ID_KEY = "cataloggy_profile_id";
const PROFILE_TOKEN_KEY = "cataloggy_profile_token";

// Identity of whoever the in-memory cache's entries belong to. Bumped rather
// than derived from the token itself: the counter is enough to make every old
// key unreachable after a rotation, without putting a credential in a map key.
let identityEpoch = 0;

const applyCacheScope = () => setCacheScope(`${runtimeConfig.getProfileId()}#${identityEpoch}`);

export const runtimeConfig = {
  apiBaseDefault: API_BASE_DEFAULT,
  addonBaseDefault: ADDON_BASE_DEFAULT,
  apiBaseOverrideKey: API_BASE_OVERRIDE_KEY,
  tokenKey: TOKEN_KEY,
  profileIdKey: PROFILE_ID_KEY,
  getApiBaseOverride() {
    return window.localStorage.getItem(API_BASE_OVERRIDE_KEY)?.trim() ?? "";
  },
  setApiBaseOverride(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(API_BASE_OVERRIDE_KEY, trimmed);
    }
    // The service worker decides what to cache by comparing against the API
    // base, and this override lives only here — a worker never told about it
    // would go on matching the base the container was built with.
    void tellServiceWorkerWhereTheApiIs();
  },
  getApiBase() {
    return runtimeConfig.getApiBaseOverride() || API_BASE_DEFAULT;
  },
  getAddonBase() {
    return ADDON_BASE_DEFAULT;
  },
  getToken() {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  },
  setToken(value: string) {
    const trimmed = value.trim();
    // Cached GET responses are partitioned by a digest of the token, so a new
    // token can never *read* the old one's entries — but they stay in Cache
    // Storage, readable by any same-origin script, until they expire a day
    // later. Signing out or rotating the token has to take them with it, so
    // the next person on a shared device inherits nothing.
    if (trimmed !== runtimeConfig.getToken()) {
      identityEpoch += 1;
      void purgeApiCache();
    }

    if (!trimmed) {
      window.localStorage.removeItem(TOKEN_KEY);
      applyCacheScope();
      return;
    }

    window.localStorage.setItem(TOKEN_KEY, trimmed);
    applyCacheScope();
  },
  getProfileId() {
    return window.localStorage.getItem(PROFILE_ID_KEY) ?? "";
  },
  setProfileId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(PROFILE_ID_KEY);
      applyCacheScope();
      return;
    }

    window.localStorage.setItem(PROFILE_ID_KEY, trimmed);
    // Switching profiles must not let the new one read the old one's rows out
    // of memory, the same way the service-worker cache is partitioned by
    // profile — so the scope changes and the previous entries become
    // unreachable in the same tick the id does.
    applyCacheScope();
  },
  clearProfileId() {
    // Leaving a profile (its access token expired, or it locked) is a sign-out
    // of that profile — its cached responses go with it.
    void purgeApiCache();
    window.localStorage.removeItem(PROFILE_ID_KEY);
    window.localStorage.removeItem(PROFILE_TOKEN_KEY);
    applyCacheScope();
  },
  // Signed capability returned by POST /profiles/:id/verify. Sent as the
  // x-profile-token header so PIN-protected profiles pass the server-side gate.
  getProfileToken() {
    return window.localStorage.getItem(PROFILE_TOKEN_KEY) ?? "";
  },
  setProfileToken(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(PROFILE_TOKEN_KEY);
      return;
    }

    window.localStorage.setItem(PROFILE_TOKEN_KEY, trimmed);
  },
  clearProfileToken() {
    window.localStorage.removeItem(PROFILE_TOKEN_KEY);
  }
};

export type MediaType = "movie" | "series";

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
  imdbRating?: number | null;
  rtScore?: number | null;
  mcScore?: number | null;
  // Detail fields — undefined = not yet fetched
  runtime?: number | null;
  certification?: string | null;
  status?: string | null;
  network?: string | null;
  releaseDate?: string | null;
  tmdbId?: number | null;
  background?: string | null;
};

export type ListItem = {
  listId: string;
  type: MediaType;
  imdbId: string;
  addedAt: string;
};

export type ListItemWithMeta = ListItem & {
  // Title captured when the item was added — stands in until the metadata row lands.
  title?: string | null;
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
  poster?: string;
  year?: number;
  description?: string;
};

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

export type WatchEvent = {
  id: string;
  imdbId: string;
  seriesImdbId?: string;
  type: "movie" | "episode";
  name: string;
  poster?: string;
  season?: number;
  episode?: number;
  watchedAt: string;
  dateUnknown: boolean;
  /** Free text attached to this watch. Trakt imports carry theirs across. */
  note?: string | null;
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
  poster?: string;
  year?: number;
  description?: string;
  genres?: string[];
  rating?: number;
};

/**
 * What a rating can be about. Wider than `MediaType` because a series can be
 * rated as a whole, season by season, or episode by episode — `season` and
 * `episode` ratings carry the numbers that locate them, keyed by the series'
 * IMDb id.
 */
export type RatingType = MediaType | "season" | "episode";

/**
 * Only season and episode ratings carry the numbers that locate them; sending
 * them for a movie or series rating would be noise the API pins to 0 anyway.
 */
const ratingTarget = (type: RatingType, target?: RatingTarget) =>
  type === "season"
    ? { season: target?.season ?? 0 }
    : type === "episode"
      ? { season: target?.season ?? 0, episode: target?.episode ?? 0 }
      : {};

const ratingQuery = (type: RatingType, target?: RatingTarget) => {
  const params = new URLSearchParams(
    Object.entries(ratingTarget(type, target)).map(([k, v]) => [k, String(v)])
  );
  const query = params.toString();
  return query ? `?${query}` : "";
};

/** Locates a season or episode rating; omitted entirely for movies and series. */
export type RatingTarget = { season?: number; episode?: number };

export type UserRating = {
  imdbId: string;
  type: RatingType;
  season?: number;
  episode?: number;
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
  seriesImdbId?: string;
  name: string;
  poster?: string;
  background?: string;
  season?: number;
  episode?: number;
  startedAt: string;
  expiresAt?: string;
};

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

const authHeaders = (hasBody: boolean) => {
  const token = runtimeConfig.getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  const profileId = runtimeConfig.getProfileId();
  if (profileId) {
    headers["x-profile-id"] = profileId;
  }
  const profileToken = runtimeConfig.getProfileToken();
  if (profileToken) {
    headers["x-profile-token"] = profileToken;
  }
  return headers;
};

/** Mirrors `API_CACHE_NAME` in `sw.js` — the runtime cache of GET API responses. */
const API_CACHE_NAME = "api-runtime-v1";

/**
 * Drops every cached API response, whether or not a service worker is around
 * to be asked. `notifyServiceWorkerToInvalidateApiCache` is a no-op when no SW
 * controls the page (first load, a hard reload, an unregistered worker), which
 * is fine for the freshness case it exists for but not for signing out: the
 * previous token's responses have to leave Cache Storage even then. Cache
 * Storage is same-origin, so the page can delete the cache itself.
 */
export async function purgeApiCache(): Promise<void> {
  invalidateMemoryCache();
  await notifyServiceWorkerToInvalidateApiCache();
  try {
    if (typeof caches !== "undefined") await caches.delete(API_CACHE_NAME);
  } catch {
    // Cache Storage is unavailable (private mode in some browsers, non-secure
    // origin) — there is nothing cached to purge in that case either.
  }
}

/**
 * Tells the service worker which origin and path prefix the API answers on, so
 * its runtime cache matches the requests this browser actually makes.
 *
 * Returns without sending anything when there is no active worker to send to —
 * nothing registered, or one still installing. `navigator.serviceWorker.ready`
 * would be the obvious thing to await, but it never settles when nothing is
 * registered: on a browser that supports service workers but has none (a plain
 * http:// LAN deployment, say) every call would leave a promise pending for the
 * life of the page. The install-time read of `config.js` covers the worker's
 * first run either way, and a later call — the override changing, the next page
 * load — reaches it once it is active.
 */
export async function tellServiceWorkerWhereTheApiIs(): Promise<void> {
  if (!navigator.serviceWorker) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = navigator.serviceWorker.controller ?? registration?.active;
    if (!worker) return;
    worker.postMessage({ type: "SET_API_BASE", apiBase: runtimeConfig.getApiBase() });
  } catch {
    // Nothing to tell (unsupported, or a non-secure origin where the registration
    // lookup itself throws).
  }
}

/**
 * How long to wait for the worker's ack before giving up on this one.
 *
 * A worker that answers does it in about a millisecond — this is the budget
 * for a busy one, not for one that is never going to reply.
 */
const INVALIDATE_ACK_TIMEOUT_MS = 200;

/**
 * Which workers answer `INVALIDATE_API_CACHE`, keyed by the worker itself.
 *
 * A worker that predates the ack handshake never replies, and the wait below is
 * on the path of every mutation the app makes: with the old one-second budget,
 * a self-hoster who had updated Cataloggy but not yet reloaded paid a full
 * second of spinner on every "Add to list" — after the server had already
 * answered. Once a controller has failed to reply, stop waiting on it. The
 * message is still sent, so the invalidation still happens; there is just
 * nothing to await.
 *
 * Per worker rather than one flag reset on `controllerchange`, because the two
 * are not the same during the 200ms after an update takes over: a timeout armed
 * for the outgoing worker outlives the switch, and it cannot tell whether the
 * flag it is about to write is still describing the worker it was armed for.
 * Reset-on-change loses that race and marks the *new* worker silent — which
 * turns the wait off exactly when the arriving build is the one that can answer
 * it. Keyed on the worker, a late timeout writes a verdict about the worker it
 * belongs to, and nothing else reads it.
 */
const workerAcksInvalidation = new WeakMap<ServiceWorker, boolean>();

export function notifyServiceWorkerToInvalidateApiCache(): Promise<void> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve();

  const channel = new MessageChannel();
  const acked = new Promise<void>((resolve) => {
    channel.port1.onmessage = () => {
      workerAcksInvalidation.set(sw, true);
      resolve();
    };
  });
  sw.postMessage({ type: "INVALIDATE_API_CACHE" }, [channel.port2]);

  // Awaiting the ack is what keeps a refetch issued right after a mutation from
  // being served the response the mutation just invalidated — the runtime cache
  // is stale-while-revalidate, so a read that beats the delete paints stale data
  // and says nothing about it. Worth a millisecond; not worth a second.
  if (workerAcksInvalidation.get(sw) === false) return Promise.resolve();

  return Promise.race([
    acked,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        // Only if nothing is known yet: an ack that arrived while this timeout
        // was pending is the newer answer, and the truthful one.
        if (!workerAcksInvalidation.has(sw)) workerAcksInvalidation.set(sw, false);
        resolve();
      }, INVALIDATE_ACK_TIMEOUT_MS);
    }),
  ]);
}

/**
 * The in-memory cache prefixes a write to `path` can change, or `null` for
 * "no idea — drop everything".
 *
 * Every mutation used to take the second branch. `invalidateAll()` is correct
 * but blunt: rating one episode dropped the lists page's rows, the games
 * library's and the calendar's along with the stats it actually moved, so the
 * next visit to any of them was a full refetch behind a skeleton — precisely
 * the wait `useCachedState` exists to remove.
 *
 * The rules below only claim what the API's own routes make true, and anything
 * unrecognised still falls through to a full drop, so a new endpoint is
 * over-invalidated rather than silently served stale.
 */
export function invalidatedCachePrefixes(path: string): string[] | null {
  // The route, without the query string a few of these carry (`/checkin?log=1`).
  const route = path.split(/[?#]/)[0];
  const under = (prefix: string) => route === prefix || route.startsWith(`${prefix}/`);

  // Nothing outside the games library reads a game: the watch stats, the
  // calendar and the dashboard rails are all built from watch events.
  if (under("/games")) return ["games:"];

  // List membership is read by the lists page and by the detail panel, which
  // fetches on open rather than from this cache. Watch progress, history,
  // stats and the calendar are all independent of it — none of the write paths
  // in `routes/lists.ts` touch a watch row.
  if (under("/lists")) return ["lists:"];

  // A rating shows up in the "top rated" section of the detailed stats, which
  // the stats page and the dashboard each cache under their own key. It is not
  // part of a watch event, a list or the calendar.
  if (under("/ratings")) return ["stats:", "dash:"];

  // The watch domain, and the widest of the three: a watch writes a history
  // row, moves the totals, updates series progress — and the calendar is built
  // from that same progress table, so a first episode of a new series adds a
  // row to it.
  if (
    under("/watch") ||
    under("/checkin") ||
    /^\/series\/[^/]+\/(watch-next|season\/)/.test(route) ||
    /^\/show\/[^/]+\/drop$/.test(route)
  ) {
    return ["dash:", "history:", "stats:", "calendar:"];
  }

  // Settings, keys, integrations and imports. A Trakt import writes thousands
  // of watch rows, a metadata refresh changes every poster, and a language
  // change re-renders titles — these genuinely do mean everything.
  return null;
}

declare global {
  interface Window {
    /** Set by public/preload-dashboard.js — in-flight responses started during HTML parse. */
    __CATALOGGY_PRELOAD__?: Record<string, Promise<Response | null>>;
  }
}

/**
 * Claims the response that `preload-dashboard.js` started for `path`, if there
 * is one. Each is claimed at most once and removed as it is taken, so a later
 * refresh of the same endpoint goes to the network as normal — this stands in
 * for the very first request of a session, not for the cache.
 */
function claimPreloadedResponse(path: string): Promise<Response | null> | null {
  const preloaded = window.__CATALOGGY_PRELOAD__;
  if (!preloaded) return null;
  const pending = preloaded[path];
  if (!pending) return null;
  delete preloaded[path];
  return pending;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 30000;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", onExternalAbort);
  }

  let response: Response;
  try {
    // A GET the preload script already started: adopt it rather than issue a
    // second one. Only for plain GETs — anything with a body, custom headers or
    // a caller-supplied signal is not the request that was preloaded.
    const claimed =
      method === "GET" && !init?.body && !init?.headers && !init?.signal
        ? claimPreloadedResponse(path)
        : null;

    // An adopted preload is a promise nothing else governs: the timeout above
    // and any caller abort apply to `fetch`, not to a request the page head
    // started. Racing it against the same signal keeps both behaving alike, so a
    // preload that never settles cannot hang the caller forever.
    const preloaded = claimed
      ? await Promise.race([
          claimed,
          new Promise<never>((_, reject) => {
            const abort = () =>
              reject(new DOMException("The operation was aborted.", "AbortError"));
            if (controller.signal.aborted) abort();
            else controller.signal.addEventListener("abort", abort, { once: true });
          }),
        ])
      : null;

    response =
      preloaded ??
      (await fetch(`${runtimeConfig.getApiBase()}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...authHeaders(init?.body != null),
          ...(init?.headers ?? {})
        }
      }));
  } catch (err) {
    if (init?.signal?.aborted) {
      // The caller cancelled this request on purpose (e.g. a newer request
      // superseded it) — rethrow the original AbortError as-is so callers
      // can detect and silently ignore intentional cancellations instead
      // of surfacing a misleading error.
      throw err;
    }
    if (timedOut) {
      throw new Error(`Request timed out – is the API server running at ${runtimeConfig.getApiBase()}?`, { cause: err });
    }
    // The device has no network at all, so the server-misconfiguration message
    // below would send the user to debug an install that is working fine. Only
    // `onLine === false` is trustworthy here: `true` covers "on Wi-Fi that
    // can't see the API", which really is the case that message is for.
    if (navigator.onLine === false) {
      throw new Error("You're offline – this needs a connection. Try again once you're back online.", { cause: err });
    }
    throw new Error(`Network error – cannot reach ${runtimeConfig.getApiBase()}. Check that the API server is running and the URL is correct.`, { cause: err });
  } finally {
    // Clear stale cache entries for attempted mutations even if the request
    // itself failed or timed out below — a half-failed write can still have
    // landed server-side, and we'd rather over-invalidate than serve stale data.
    clearTimeout(timeoutId);
    init?.signal?.removeEventListener("abort", onExternalAbort);
    if (method !== "GET") {
      // Same over-invalidate-rather-than-serve-stale rule the service-worker
      // cache follows, applied to the in-memory one: a write can touch rows on
      // pages other than the one that issued it, and the cost of being wrong
      // here is showing the user data they just changed. What it does not have
      // to do is take pages the write cannot reach down with it — see
      // `invalidatedCachePrefixes`.
      const prefixes = invalidatedCachePrefixes(path);
      if (prefixes === null) invalidateMemoryCache();
      else for (const prefix of prefixes) invalidateCachePrefix(prefix);
      await notifyServiceWorkerToInvalidateApiCache();
    }
  }

  if (!response.ok) {
    const body = await response.text();
    // API errors are shaped as JSON: { "error": "human-readable message" }.
    // Fall back to the raw body if it isn't (or isn't valid JSON) so nothing
    // is ever silently swallowed.
    let message = body;
    let errorCode: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
        if (typeof parsed.error === "string" && parsed.error.trim()) {
          message = parsed.error;
        }
        if (typeof parsed.code === "string") {
          errorCode = parsed.code;
        }
      } catch {
        // not JSON — use the raw body as-is
      }
    }
    // A PIN-protected profile's access token is missing or expired. Drop the
    // stale profile selection and prompt the user to re-verify, rather than
    // leaving every page stuck on a 401.
    if (response.status === 401 && errorCode === "profile_verification_required") {
      runtimeConfig.clearProfileId();
      window.dispatchEvent(new Event("cataloggy:profile-locked"));
    }
    // A 401 with a WWW-Authenticate header (RFC 6750) comes from the bearer-token
    // auth middleware itself, meaning the stored token is missing/invalid/rotated —
    // as opposed to a route-level 401 like an incorrect profile PIN. Clear it and
    // tell the app to fall back to the setup wizard instead of leaving every page
    // stuck on a generic "Unable to connect" error for the rest of the session.
    if (response.status === 401 && response.headers.get("www-authenticate")) {
      runtimeConfig.setToken("");
      window.dispatchEvent(new Event("cataloggy:unauthorized"));
    }
    throw new ApiError(message || `Request failed: ${response.status}`, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") && !contentType.includes("+json")) {
    throw new Error(
      `Expected JSON from API but received "${contentType}". ` +
      `Make sure ${runtimeConfig.getApiBase()} points to the Cataloggy API server, not the web UI.`
    );
  }

  return response.json() as Promise<T>;
}

export const api = {
  search(type: MediaType, query: string, signal?: AbortSignal) {
    return request<SearchResult[]>(`/search?type=${type}&query=${encodeURIComponent(query)}`, { signal, timeoutMs: 15000 });
  },
  getLists(signal?: AbortSignal) {
    return request<{ lists: CatalogList[] }>("/lists", { signal });
  },
  createList(name: string) {
    return request<{ list: CatalogList }>("/lists", {
      method: "POST",
      body: JSON.stringify({ name, kind: "custom" })
    });
  },
  deleteList(listId: string) {
    return request<void>(`/lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
  },
  renameList(listId: string, name: string) {
    return request<{ list: CatalogList }>(`/lists/${encodeURIComponent(listId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  addToList(listId: string, payload: { type: MediaType; imdbId: string; title: string }) {
    const encodedListId = encodeURIComponent(listId);

    return request(`/lists/${encodedListId}/items`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getListItems(listId: string, signal?: AbortSignal) {
    return request<{ items: ListItemWithMeta[] }>(
      `/lists/${encodeURIComponent(listId)}/items`,
      { signal }
    );
  },
  removeFromList(listId: string, item: { type: MediaType; imdbId: string }) {
    const encodedListId = encodeURIComponent(listId);
    const encodedImdbId = encodeURIComponent(item.imdbId);

    return request(`/lists/${encodedListId}/items/${item.type}/${encodedImdbId}`, {
      method: "DELETE"
    });
  },
  dashboard() {
    return Promise.all([
      request<{ metas: CatalogMeta[] }>("/watchlist?type=movie&limit=10"),
      request<{ metas: CatalogMeta[] }>("/continue?limit=10"),
      request<{ metas: CatalogMeta[] }>("/recent?type=movie&limit=10")
    ]);
  },
  async getSeriesProgress(signal?: AbortSignal) {
    const res = await request<{ progress: SeriesProgress[] }>("/series/progress", { signal });
    return res.progress;
  },
  async getWatchHistory(
    limit = 10,
    offset = 0,
    opts?: { imdbId?: string; type?: "movie" | "episode"; signal?: AbortSignal }
  ) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (opts?.imdbId) params.set("imdbId", opts.imdbId);
    if (opts?.type) params.set("type", opts.type);
    const res = await request<{ history: WatchEvent[] }>(`/watch/history?${params}`, { signal: opts?.signal });
    return res.history;
  },
  getWatchStats(signal?: AbortSignal) {
    return request<WatchStats>("/watch/stats", { signal });
  },
  markNextEpisodeWatched(imdbId: string) {
    return request<void>(`/series/${encodeURIComponent(imdbId)}/watch-next`, {
      method: "POST"
    });
  },
  getTraktStatus() {
    return request<{ connected: boolean; configured: boolean; expiresAt: string | null; redirectUri: string }>("/trakt/status");
  },
  getTraktOAuthUrl() {
    return request<{ url: string }>("/trakt/oauth/authorize");
  },
  traktImport() {
    // A full history import walks every play on the account, so this is sized
    // for a decade-old library on a slow connection rather than a routine sync.
    return request<{ imported: Record<string, number> }>("/trakt/import", { method: "POST", timeoutMs: 900000 });
  },
  traktDisconnect() {
    return request<{ disconnected: boolean }>("/trakt/disconnect", { method: "POST" });
  },
  getStremioLibraryStatus() {
    return request<StremioLibraryStatus>("/stremio/library/status");
  },
  stremioLibraryConnect(email: string, password: string) {
    return request<StremioLibraryStatus>("/stremio/library/connect", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  stremioLibraryDisconnect() {
    return request<{ connected: boolean }>("/stremio/library/disconnect", { method: "POST" });
  },
  stremioLibraryImport() {
    return request<StremioSyncSummary>("/stremio/library/import", { method: "POST", timeoutMs: 120000 });
  },
  stremioLibrarySync() {
    return request<StremioSyncSummary>("/stremio/library/sync", { method: "POST", timeoutMs: 60000 });
  },
  getStremioPlaySignals() {
    return request<{ enabled: boolean; signals: PlaySignal[] }>("/stremio/play-signals");
  },
  refreshAllMetadata() {
    return request<{ refreshed: number; total: number }>("/metadata/refresh-all", { method: "POST", timeoutMs: 120000 });
  },
  getRpdbStatus() {
    return request<{ configured: boolean; hasKey: boolean }>("/rpdb/status");
  },
  setRpdbKey(apiKey: string) {
    return request<{ configured: boolean }>("/rpdb/key", {
      method: "POST",
      body: JSON.stringify({ apiKey })
    });
  },
  removeRpdbKey() {
    return request<{ configured: boolean }>("/rpdb/key", { method: "DELETE" });
  },
  getOmdbStatus() {
    return request<{ configured: boolean }>("/omdb/status");
  },
  getTmdbStatus() {
    return request<TmdbStatus>("/tmdb/status");
  },
  setTmdbKey(apiKey: string) {
    return request<TmdbStatus>("/tmdb/key", {
      method: "POST",
      body: JSON.stringify({ apiKey })
    });
  },
  removeTmdbKey() {
    return request<TmdbStatus>("/tmdb/key", { method: "DELETE" });
  },
  setOmdbKey(apiKey: string) {
    return request<{ configured: boolean }>("/omdb/key", {
      method: "POST",
      body: JSON.stringify({ apiKey })
    });
  },
  removeOmdbKey() {
    return request<{ configured: boolean }>("/omdb/key", { method: "DELETE" });
  },
  getJobStatus() {
    return request<{ failures: JobFailure[]; runs?: JobRun[] }>("/settings/job-status");
  },
  getDetailedStats(signal?: AbortSignal) {
    return request<DetailedWatchStats>("/watch/stats/detailed", { signal });
  },
  getYearInReview(year: number) {
    return request<YearInReviewStats>(`/watch/stats/year/${year}`);
  },
  getAddonConfig() {
    return request<{
      config: AddonConfig;
      availableCatalogs: AddonCatalogOption[];
      availableLists: { id: string; name: string }[];
      aiConfigured: boolean;
    }>("/addon/config");
  },
  updateAddonConfig(enabledCatalogs: string[]) {
    return request<{ config: AddonConfig }>("/addon/config", {
      method: "POST",
      body: JSON.stringify({ enabledCatalogs })
    });
  },
  getItemLists(imdbId: string) {
    return request<{ lists: ItemListMembership[] }>(`/items/${encodeURIComponent(imdbId)}/lists`);
  },
  // Trending & Popular
  getTrending(type: MediaType, window: "day" | "week" = "week") {
    return request<{ metas: TrendingMeta[] }>(`/trending?type=${type}&window=${window}`);
  },
  getPopular(type: MediaType) {
    return request<{ metas: TrendingMeta[] }>(`/popular?type=${type}`);
  },
  // Ratings
  setRating(imdbId: string, type: RatingType, rating: number, target?: RatingTarget) {
    return request<{ rating: UserRating }>("/ratings", {
      method: "POST",
      body: JSON.stringify({ imdbId, type, rating, ...ratingTarget(type, target) }),
    });
  },
  getRating(type: RatingType, imdbId: string, target?: RatingTarget) {
    return request<{ rating: UserRating }>(
      `/ratings/${type}/${encodeURIComponent(imdbId)}${ratingQuery(type, target)}`
    );
  },
  deleteRating(type: RatingType, imdbId: string, target?: RatingTarget) {
    return request<void>(`/ratings/${type}/${encodeURIComponent(imdbId)}${ratingQuery(type, target)}`, {
      method: "DELETE",
    });
  },
  getAllRatings(type?: RatingType, limit = 50) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    params.set("limit", String(limit));
    return request<{ ratings: UserRating[] }>(`/ratings?${params}`);
  },
  /**
   * Every rating recorded against one title — the series itself, its seasons
   * and its episodes — in a single request, so the seasons panel doesn't fire
   * one per row.
   */
  getTitleRatings(imdbId: string) {
    return request<{ ratings: UserRating[] }>(`/ratings?imdbId=${encodeURIComponent(imdbId)}`);
  },
  // Recommendations
  getPersonalRecommendations(type: MediaType, limit = 20) {
    return request<{ metas: TrendingMeta[] }>(`/recommendations/personal?type=${type}&limit=${limit}`);
  },
  // Calendar
  getCalendar(days = 30) {
    return request<{ calendar: CalendarEntry[] }>(`/calendar?days=${days}`);
  },
  // Streaming
  getStreamingCatalog(type: MediaType, provider: string) {
    return request<{ metas: TrendingMeta[]; provider: string }>(`/streaming?type=${type}&provider=${encodeURIComponent(provider)}`);
  },
  getStreamingProviders() {
    return request<{ providers: Array<{ key: string; id: number; name: string }> }>("/streaming/providers");
  },
  // Anime
  getAnimeCatalog(type: MediaType) {
    return request<{ metas: TrendingMeta[] }>(`/anime?type=${type}`);
  },
  /**
   * Everything the detail panel opens with, in one request.
   *
   * The panel used to fire six in parallel — meta, cast, providers,
   * recommendations, and for a series seasons and dropped-state. Parallel isn't
   * free on a phone: they queue behind the connection limit, and the panel could
   * only finish filling in when the slowest of the six landed.
   */
  getDetailBundle(type: MediaType, imdbId: string, signal?: AbortSignal) {
    return request<DetailBundle>(`/meta/${type}/${encodeURIComponent(imdbId)}/bundle`, { signal });
  },
  /**
   * Still its own call: the search page fetches providers per result row as the
   * row scrolls into view, which is a different access pattern from the panel's
   * one-shot bundle.
   */
  getWatchProviders(type: MediaType, imdbId: string, signal?: AbortSignal) {
    return request<{ providers: WatchProviders }>(
      `/meta/${type}/${encodeURIComponent(imdbId)}/providers`, { signal }
    );
  },
  getSeasonEpisodes(imdbId: string, seasonNumber: number, signal?: AbortSignal) {
    return request<{ episodes: EpisodeInfo[] }>(
      `/meta/series/${encodeURIComponent(imdbId)}/season/${seasonNumber}/episodes`, { signal }
    );
  },
  getWatchedEpisodes(imdbId: string, signal?: AbortSignal) {
    return request<{ episodes: WatchedEpisode[] }>(
      `/series/${encodeURIComponent(imdbId)}/watched-episodes`, { signal }
    );
  },
  markEpisodeWatched(imdbId: string, seasonNumber: number, episodeNumber: number) {
    return request<void>(
      `/series/${encodeURIComponent(imdbId)}/season/${seasonNumber}/episode/${episodeNumber}/watch`,
      { method: "POST" }
    );
  },
  unmarkEpisodeWatched(imdbId: string, seasonNumber: number, episodeNumber: number) {
    return request<void>(
      `/series/${encodeURIComponent(imdbId)}/season/${seasonNumber}/episode/${episodeNumber}/watch`,
      { method: "DELETE" }
    );
  },
  markSeasonWatched(imdbId: string, seasonNumber: number, episodeNumbers: number[]) {
    return request<{ marked: number; total: number }>(
      `/series/${encodeURIComponent(imdbId)}/season/${seasonNumber}/watch-all`,
      { method: "POST", body: JSON.stringify({ episodeNumbers }) }
    );
  },
  dropShow(imdbId: string) {
    return request<{ dropped: boolean }>(`/show/${encodeURIComponent(imdbId)}/drop`, { method: "POST" });
  },
  undropShow(imdbId: string) {
    return request<{ dropped: boolean }>(`/show/${encodeURIComponent(imdbId)}/drop`, { method: "DELETE" });
  },
  deleteWatchEvent(eventId: string) {
    return request<void>(`/watch/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  },
  // Sets or clears the note on a watch that already exists — the only way to
  // change one, since the note travels with the event at creation time.
  updateWatchEventNote(eventId: string, note: string | null) {
    return request<{ watchEvent: WatchEvent }>(`/watch/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    });
  },
  logWatch(payload: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string; season?: number; episode?: number; watchedAt: string; dateUnknown?: boolean; note?: string | null }) {
    return request<{ watchEvent: { id: string } }>("/watch", { method: "POST", body: JSON.stringify(payload) });
  },
  // Check-in
  getCheckin(signal?: AbortSignal) {
    return request<{ checkin: CheckIn | null }>("/checkin", { signal });
  },
  startCheckin(payload: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string; name: string; poster?: string; season?: number; episode?: number; runtime?: number | null }) {
    return request<{ checkin: CheckIn }>("/checkin", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  endCheckin(logWatch = false) {
    return request<void>(`/checkin?log=${logWatch}`, { method: "DELETE" });
  },
  // Preferences (language, region, spoiler protection)
  getPreferences() {
    return request<UserPreferences>("/settings/preferences");
  },
  updatePreferences(prefs: Partial<UserPreferences>) {
    return request<UserPreferences>("/settings/preferences", {
      method: "POST",
      body: JSON.stringify(prefs),
    });
  },
  // AI Recommendations
  getAiConfig() {
    return request<{ configured: boolean; config: Record<string, unknown> | null; lastGeneratedAt: string | null }>("/ai/config");
  },
  saveAiConfig(config: Record<string, unknown>) {
    return request<{ configured: boolean }>("/ai/config", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
  },
  deleteAiConfig() {
    return request<{ configured: boolean }>("/ai/config", { method: "DELETE" });
  },
  testAiConfig(config: Record<string, unknown>) {
    return request<{ success: boolean; response?: string; error?: string }>("/ai/test", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
  },
  refreshAiRecs() {
    return request<{ refreshed: boolean }>("/recommendations/ai/refresh", { method: "POST", timeoutMs: 60000 });
  },
  getAiRecommendations(type: MediaType, limit = 20) {
    return request<{ metas: TrendingMeta[]; reasons?: Record<string, string> }>(`/recommendations/ai?type=${type}&limit=${limit}`);
  },
  // Push notifications
  getPushPublicKey() {
    return request<{ publicKey: string }>("/push/public-key");
  },
  pushSubscribe(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ subscribed: boolean }>("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    });
  },
  pushUnsubscribe(endpoint: string) {
    return request<{ subscribed: boolean }>("/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  },
  // Notification channels (ntfy, Gotify, Discord, generic webhook)
  getNotificationChannels() {
    return request<{ channels: NotificationChannel[] }>("/notifications/channels");
  },
  createNotificationChannel(payload: {
    kind: NotificationChannelKind;
    name?: string;
    url: string;
    token?: string;
  }) {
    return request<{ channel: NotificationChannel }>("/notifications/channels", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  // Omitting `token` keeps the stored one; an empty string clears it.
  updateNotificationChannel(
    id: string,
    payload: { name?: string; url?: string; token?: string; enabled?: boolean }
  ) {
    return request<{ channel: NotificationChannel }>(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  deleteNotificationChannel(id: string) {
    return request<{ deleted: boolean }>(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  testNotificationChannel(id: string) {
    return request<{ success: boolean; error?: string }>(
      `/notifications/channels/${encodeURIComponent(id)}/test`,
      { method: "POST", timeoutMs: 20000 }
    );
  },
  // Profiles
  getProfiles() {
    return request<{ profiles: Profile[] }>("/profiles");
  },
  createProfile(payload: { name: string; pin?: string }) {
    return request<{ profile: Profile }>("/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async verifyProfile(profileId: string, pin?: string) {
    const result = await request<{ id: string; name: string; profileToken?: string }>(
      `/profiles/${encodeURIComponent(profileId)}/verify`,
      {
        method: "POST",
        body: JSON.stringify(pin ? { pin } : {}),
      }
    );
    // Persist the signed capability so subsequent requests for this profile
    // clear the server-side PIN gate.
    runtimeConfig.setProfileToken(result.profileToken ?? "");
    return result;
  },
  updateProfile(profileId: string, payload: { name?: string; pin?: string | null; currentPin?: string }) {
    return request<{ profile: Profile }>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  // `currentPin` is required by the server for a PIN-protected profile unless
  // the stored profile token was minted for that same profile — deleting one
  // takes its whole history with it, so it is gated like a PIN change.
  deleteProfile(profileId: string, currentPin?: string) {
    return request<void>(`/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
      ...(currentPin ? { body: JSON.stringify({ currentPin }) } : {}),
    });
  },
  // Now playing (live Plex/Jellyfin scrobble sessions)
  getNowPlaying(signal?: AbortSignal) {
    return request<{ sessions: ScrobbleSession[] }>("/scrobble/now-playing", { signal });
  },
  // Data export / import
  exportData() {
    return request<ExportPayload>("/export", { timeoutMs: 60000 });
  },
  importData(payload: ExportPayload) {
    return request<{ status: string; summary: ImportSummary }>("/import", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 60000,
    });
  },
  importCsv(csv: string) {
    return request<{ status: string; summary: { imported: number; skipped: number } }>("/import/csv", {
      method: "POST",
      body: JSON.stringify({ csv }),
      timeoutMs: 60000,
    });
  },
  // Tags
  getItemTags(type: "movie" | "series" | "episode", imdbId: string) {
    return request<{ tags: { id: string; name: string; createdAt: string }[] }>(
      `/tags?type=${type}&imdbId=${encodeURIComponent(imdbId)}`
    );
  },
  assignTag(tagName: string, type: "movie" | "series" | "episode", imdbId: string) {
    return request<{ tag: { id: string; name: string; createdAt: string } }>("/tags/assign", {
      method: "POST",
      body: JSON.stringify({ tagName, type, imdbId }),
    });
  },
  removeTag(tagId: string, type: "movie" | "series" | "episode", imdbId: string) {
    return request<void>("/tags/assign", {
      method: "DELETE",
      body: JSON.stringify({ tagId, type, imdbId }),
    });
  },
  importExternal(format: "letterboxd-diary" | "letterboxd-ratings" | "imdb-ratings" | "simkl", csv: string) {
    return request<{
      status: string;
      format: string;
      summary: { imported: number; ratingsImported: number; skipped: number };
    }>("/import/external", {
      method: "POST",
      body: JSON.stringify({ format, csv }),
      timeoutMs: 120000,
    });
  },
  // Games
  async listGames(sort: GameSort = "recent", signal?: AbortSignal) {
    const res = await request<{ games: Game[] }>(`/games?sort=${sort}`, { signal });
    return res.games;
  },
  async searchGames(query: string, signal?: AbortSignal) {
    const res = await request<{ results: GameSearchResult[] }>(
      `/games/search?q=${encodeURIComponent(query)}`,
      { signal }
    );
    return res.results;
  },
  addGame(payload: { igdbId: number; title: string; coverUrl?: string | null; releaseDate?: string | null; genres?: string[] }) {
    return request<{ game: Game }>("/games", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateGame(id: string, payload: Partial<{ rating: number | null; notes: string | null; finished: boolean; finishedAt: string | null }>) {
    return request<{ game: Game }>(`/games/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  deleteGame(id: string) {
    return request<void>(`/games/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  getSteamStatus() {
    return request<SteamStatus>("/games/steam/status");
  },
  triggerSteamSync() {
    return request<SteamSyncSummary>("/games/steam/sync", { method: "POST", timeoutMs: 60000 });
  },
};
