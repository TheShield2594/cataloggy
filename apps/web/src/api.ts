const API_BASE_DEFAULT = import.meta.env.VITE_API_BASE ?? "http://localhost:7000";
const API_BASE_OVERRIDE_KEY = "cataloggy_api_base_override";
const TOKEN_KEY = "cataloggy_token";

export const runtimeConfig = {
  apiBaseDefault: API_BASE_DEFAULT,
  apiBaseOverrideKey: API_BASE_OVERRIDE_KEY,
  tokenKey: TOKEN_KEY,
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
};

export type ListItem = {
  listId: string;
  type: MediaType;
  imdbId: string;
  addedAt: string;
};

export type ListItemWithMeta = ListItem & {
  metadata: { name: string; poster: string | null; year: number | null } | null;
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
  type: MediaType;
  name: string;
  poster?: string;
  season?: number;
  episode?: number;
  watchedAt: string;
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

export type ItemListMembership = {
  listId: string;
  listName: string;
  listKind: string;
  type: string;
  addedAt: string;
};

const authHeaders = (hasBody: boolean) => {
  const token = runtimeConfig.getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

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
  } catch (err) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      throw new Error(`Request timed out – is the API server running at ${runtimeConfig.getApiBase()}?`);
    }
    throw new Error(`Network error – cannot reach ${runtimeConfig.getApiBase()}. Check that the API server is running and the URL is correct.`);
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
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
  search(type: MediaType, query: string) {
    return request<SearchResult[]>(`/search?type=${type}&query=${encodeURIComponent(query)}`);
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
  async getWatchHistory(limit = 10) {
    const res = await request<{ history: WatchEvent[] }>(`/watch/history?limit=${limit}`);
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
    return request<{ imported: Record<string, number> }>("/trakt/import", { method: "POST" });
  },
  traktDisconnect() {
    return request<{ disconnected: boolean }>("/trakt/disconnect", { method: "POST" });
  },
  refreshAllMetadata() {
    return request<{ refreshed: number; total: number }>("/metadata/refresh-all", { method: "POST" });
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
  getDetailedStats() {
    return request<DetailedWatchStats>("/watch/stats/detailed");
  },
  getAddonConfig() {
    return request<{ config: AddonConfig; availableCatalogs: string[] }>("/addon/config");
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
};
