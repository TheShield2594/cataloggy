/**
 * Finding something to watch: search, what is trending, what a
 * provider is carrying, and the catalogues built from those.
 */

import { request } from "./client";
import type {
  MediaType,
  SearchResult,
  TrendingMeta,
} from "./types";

export const discoverApi = {
  search(type: MediaType, query: string, signal?: AbortSignal) {
    return request<SearchResult[]>(`/search?type=${type}&query=${encodeURIComponent(query)}`, { signal, timeoutMs: 15000 });
  },
  // Trending & Popular
  getTrending(type: MediaType, window: "day" | "week" = "week") {
    return request<{ metas: TrendingMeta[] }>(`/trending?type=${type}&window=${window}`);
  },
  getPopular(type: MediaType) {
    return request<{ metas: TrendingMeta[] }>(`/popular?type=${type}`);
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
  // Recommendations
  getPersonalRecommendations(type: MediaType, limit = 20) {
    return request<{ metas: TrendingMeta[] }>(`/recommendations/personal?type=${type}&limit=${limit}`);
  },
};
