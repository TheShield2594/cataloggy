/**
 * The games library, and the two services behind it.
 */

import { request } from "./client";
import type {
  Game,
  GameSearchResult,
  GameSort,
  IgdbStatus,
  SteamStatus,
  SteamSyncSummary,
} from "./types";

/**
 * Both integration-status reads get this instead of `request()`'s 30s default,
 * because the Games page holds its empty state back until they settle: a status
 * endpoint that hangs would otherwise leave that region blank for half a minute,
 * which is worse than either sentence it is choosing between.
 *
 * Not tighter than this because `GET /games/steam/status` makes one outbound
 * Steam call when Steam is configured. Timing out costs the "Steam connected
 * as X" bar for that load and nothing else — the page falls back to treating
 * the answer as unknown, which is the safe direction.
 */
const INTEGRATION_STATUS_TIMEOUT_MS = 6000;

export const gamesApi = {
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
  addGame(payload: { igdbId: number; title: string; coverUrl?: string | null | undefined; releaseDate?: string | null | undefined; genres?: string[] | undefined }) {
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
  getSteamStatus(signal?: AbortSignal) {
    return request<SteamStatus>("/games/steam/status", { signal, timeoutMs: INTEGRATION_STATUS_TIMEOUT_MS });
  },
  getIgdbStatus(signal?: AbortSignal) {
    return request<IgdbStatus>("/games/igdb/status", { signal, timeoutMs: INTEGRATION_STATUS_TIMEOUT_MS });
  },
  triggerSteamSync() {
    return request<SteamSyncSummary>("/games/steam/sync", { method: "POST", timeoutMs: 60000 });
  },
};
