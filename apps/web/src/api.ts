export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

declare global {
  interface Window {
    __CATALOGGY_API_BASE__?: string;
  }
}

const API_BASE_DEFAULT =
  window.__CATALOGGY_API_BASE__ || import.meta.env.VITE_API_BASE || "http://localhost:7000";
const API_BASE_OVERRIDE_KEY = "cataloggy_api_base_override";
const TOKEN_KEY = "cataloggy_token";
const PROFILE_ID_KEY = "cataloggy_profile_id";

export const runtimeConfig = {
  apiBaseDefault: API_BASE_DEFAULT,
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
      return;
    }

    window.localStorage.setItem(API_BASE_OVERRIDE_KEY, trimmed);
  },
  getApiBase() {
    return runtimeConfig.getApiBaseOverride() || API_BASE_DEFAULT;
  },
  getToken() {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  },
  setToken(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(TOKEN_KEY);
      return;
    }

    window.localStorage.setItem(TOKEN_KEY, trimmed);
  },
  getProfileId() {
    return window.localStorage.getItem(PROFILE_ID_KEY) ?? "";
  },
  setProfileId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(PROFILE_ID_KEY);
      return;
    }

    window.localStorage.setItem(PROFILE_ID_KEY, trimmed);
  },
  clearProfileId() {
    window.localStorage.removeItem(PROFILE_ID_KEY);
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
};

export type ListItem = {
  listId: string;
  type: MediaType;
  imdbId: string;
  addedAt: string;
};

export type ListItemWithMeta = ListItem & {
  metadata: { name: string; poster: string | null; year: number | null; genres: string[]; rating: number | null } | null;
};

export type CatalogList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom";
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
  lastSeason: number;
  lastEpisode: number;
  nextSeason: number;
  nextEpisode: number;
  totalSeasons?: number | null;
  totalEpisodes?: number | null;
  watchedEpisodes?: number | null;
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
};

export type WatchStats = {
  totalMovies: number;
  totalEpisodes: number;
  totalPlays: number;
};

export type DetailedWatchStats = {
  monthly: { month: string; movies: number; episodes: number }[];
  genreDistribution: { genre: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  topRated: { imdbId: string; name: string; type: string; rating: number | null; poster: string | null }[];
};

export type AddonConfig = {
  enabledCatalogs: string[];
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

export type UserRating = {
  imdbId: string;
  type: MediaType;
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

export type WatchProviders = {
  link: string | null;
  flatrate: WatchProvider[];
  free: WatchProvider[];
  ads: WatchProvider[];
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
    kind: "watchlist" | "custom";
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
  return headers;
};

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (init?.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", () => controller.abort());
  }

  let response: Response;
  try {
    response = await fetch(`${runtimeConfig.getApiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...authHeaders(init?.body != null),
        ...(init?.headers ?? {})
      }
    });
  } catch {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      throw new Error(`Request timed out – is the API server running at ${runtimeConfig.getApiBase()}?`);
    }
    throw new Error(`Network error – cannot reach ${runtimeConfig.getApiBase()}. Check that the API server is running and the URL is correct.`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const message = await response.text();
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
  getLists() {
    return request<{ lists: CatalogList[] }>("/lists");
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
  getListItems(listId: string) {
    return request<{ items: ListItemWithMeta[] }>(`/lists/${encodeURIComponent(listId)}/items`);
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
  async getSeriesProgress() {
    const res = await request<{ progress: SeriesProgress[] }>("/series/progress");
    return res.progress;
  },
  async getWatchHistory(limit = 10, offset = 0, opts?: { imdbId?: string; signal?: AbortSignal }) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (opts?.imdbId) params.set("imdbId", opts.imdbId);
    const res = await request<{ history: WatchEvent[] }>(`/watch/history?${params}`, { signal: opts?.signal });
    return res.history;
  },
  getWatchStats() {
    return request<WatchStats>("/watch/stats");
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
    return request<{ imported: Record<string, number> }>("/trakt/import", { method: "POST", timeoutMs: 120000 });
  },
  traktDisconnect() {
    return request<{ disconnected: boolean }>("/trakt/disconnect", { method: "POST" });
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
    return request<{ configured: boolean }>("/tmdb/status");
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
  getDetailedStats() {
    return request<DetailedWatchStats>("/watch/stats/detailed");
  },
  getAddonConfig() {
    return request<{ config: AddonConfig; availableCatalogs: string[]; availableLists: { id: string; name: string }[] }>("/addon/config");
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
  setRating(imdbId: string, type: MediaType, rating: number) {
    return request<{ rating: UserRating }>("/ratings", {
      method: "POST",
      body: JSON.stringify({ imdbId, type, rating }),
    });
  },
  getRating(type: MediaType, imdbId: string) {
    return request<{ rating: UserRating }>(`/ratings/${type}/${encodeURIComponent(imdbId)}`);
  },
  deleteRating(type: MediaType, imdbId: string) {
    return request<void>(`/ratings/${type}/${encodeURIComponent(imdbId)}`, { method: "DELETE" });
  },
  getAllRatings(type?: MediaType, limit = 50) {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    params.set("limit", String(limit));
    return request<{ ratings: UserRating[] }>(`/ratings?${params}`);
  },
  // Recommendations
  getPersonalRecommendations(type: MediaType, limit = 20) {
    return request<{ metas: TrendingMeta[] }>(`/recommendations/personal?type=${type}&limit=${limit}`);
  },
  getRecommendations(type: MediaType, imdbId: string) {
    return request<{ metas: TrendingMeta[] }>(`/recommendations?type=${type}&imdbId=${encodeURIComponent(imdbId)}`);
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
  getItemMeta(type: MediaType, imdbId: string, signal?: AbortSignal) {
    return request<{
      imdbId: string; type: string; name: string; year: number | null; poster: string | null;
      description: string | null; genres: string[]; rating: number | null;
      imdbRating: number | null; rtScore: number | null; mcScore: number | null;
      runtime: number | null; certification: string | null;
      status: string | null; network: string | null; releaseDate: string | null;
    }>(`/meta/${type}/${encodeURIComponent(imdbId)}`, { signal });
  },
  getCast(type: MediaType, imdbId: string, signal?: AbortSignal) {
    return request<{ cast: Array<{ name: string; character: string; photo: string | null; order: number }> }>(
      `/meta/${type}/${encodeURIComponent(imdbId)}/cast`, { signal }
    );
  },
  getSeasons(imdbId: string, signal?: AbortSignal) {
    return request<{ seasons: Array<{ seasonNumber: number; name: string; episodeCount: number; airYear: number | null; poster: string | null }> }>(
      `/meta/series/${encodeURIComponent(imdbId)}/seasons`, { signal }
    );
  },
  getWatchProviders(type: MediaType, imdbId: string, signal?: AbortSignal) {
    return request<{ providers: WatchProviders }>(
      `/meta/${type}/${encodeURIComponent(imdbId)}/providers`, { signal }
    );
  },
  getDropped(imdbId: string, signal?: AbortSignal) {
    return request<{ dropped: boolean }>(`/show/${encodeURIComponent(imdbId)}/dropped`, { signal });
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
  logWatch(payload: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string; season?: number; episode?: number; watchedAt: string; dateUnknown?: boolean }) {
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
    return request<{ ok: boolean; message: string }>("/ai/test", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
  },
  refreshAiRecs() {
    return request<{ movie: number; series: number }>("/recommendations/ai/refresh", { method: "POST", timeoutMs: 60000 });
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
  verifyProfile(profileId: string, pin?: string) {
    return request<{ id: string; name: string }>(`/profiles/${encodeURIComponent(profileId)}/verify`, {
      method: "POST",
      body: JSON.stringify(pin ? { pin } : {}),
    });
  },
  deleteProfile(profileId: string) {
    return request<void>(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
  },
  // Now playing (live Plex/Jellyfin scrobble sessions)
  getNowPlaying() {
    return request<{ sessions: ScrobbleSession[] }>("/scrobble/now-playing");
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
};
