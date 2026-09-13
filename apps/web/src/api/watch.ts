/**
 * What has been watched, what is part-way through, and what is on next.
 */

import { request, validated } from "./client";
import { parseCalendarResponse, parseSeriesProgressListResponse, parseWatchHistoryResponse } from "@cataloggy/shared/contracts";
import type {
  CheckIn,
  DetailedWatchStats,
  EpisodeInfo,
  ScrobbleSession,
  WatchEvent,
  WatchStats,
  WatchedEpisode,
  YearInReviewStats,
} from "./types";

export const watchApi = {
  async getSeriesProgress(signal?: AbortSignal) {
    const res = await request<unknown>("/series/progress", { signal });
    return validated("/series/progress", parseSeriesProgressListResponse, res).progress;
  },
  async getWatchHistory(
    limit = 10,
    offset = 0,
    opts?: { imdbId?: string | undefined; type?: "movie" | "episode" | undefined; signal?: AbortSignal | undefined }
  ) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (opts?.imdbId) params.set("imdbId", opts.imdbId);
    if (opts?.type) params.set("type", opts.type);
    const res = await request<unknown>(`/watch/history?${params}`, { signal: opts?.signal });
    return validated("/watch/history", parseWatchHistoryResponse, res).history;
  },
  getWatchStats(signal?: AbortSignal) {
    return request<WatchStats>("/watch/stats", { signal });
  },
  markNextEpisodeWatched(imdbId: string) {
    return request<void>(`/series/${encodeURIComponent(imdbId)}/watch-next`, {
      method: "POST"
    });
  },
  getDetailedStats(signal?: AbortSignal) {
    return request<DetailedWatchStats>("/watch/stats/detailed", { signal });
  },
  getYearInReview(year: number) {
    return request<YearInReviewStats>(`/watch/stats/year/${year}`);
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
  logWatch(payload: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string | undefined; season?: number | undefined; episode?: number | undefined; watchedAt: string; dateUnknown?: boolean | undefined; note?: string | null | undefined }) {
    return request<{ watchEvent: { id: string } }>("/watch", { method: "POST", body: JSON.stringify(payload) });
  },
  // Check-in
  getCheckin(signal?: AbortSignal) {
    return request<{ checkin: CheckIn | null }>("/checkin", { signal });
  },
  startCheckin(payload: { type: "movie" | "episode"; imdbId: string; seriesImdbId?: string | undefined; name: string; poster?: string | undefined; season?: number | undefined; episode?: number | undefined; runtime?: number | null | undefined }) {
    return request<{ checkin: CheckIn }>("/checkin", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  endCheckin(logWatch = false) {
    return request<void>(`/checkin?log=${logWatch}`, { method: "DELETE" });
  },
  // Now playing (live Plex/Jellyfin scrobble sessions)
  getNowPlaying(signal?: AbortSignal) {
    return request<{ sessions: ScrobbleSession[] }>("/scrobble/now-playing", { signal });
  },
  // Calendar
  async getCalendar(days = 30) {
    return validated("/calendar", parseCalendarResponse, await request<unknown>(`/calendar?days=${days}`));
  },
};
