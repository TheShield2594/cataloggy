/**
 * What a title is: the detail bundle behind the panel, where it streams,
 * and the tags the user has put on it.
 */

import { request } from "./client";
import type {
  DetailBundle,
  MediaType,
  WatchProviders,
} from "./types";

export const metadataApi = {
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
  refreshAllMetadata() {
    return request<{ refreshed: number; total: number }>("/metadata/refresh-all", { method: "POST", timeoutMs: 120000 });
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
};
