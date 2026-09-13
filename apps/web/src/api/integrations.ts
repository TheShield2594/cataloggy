/**
 * The services that feed watch history in: Trakt and Stremio.
 */

import { request } from "./client";
import type {
  PlaySignal,
  StremioLibraryStatus,
  StremioSyncSummary,
} from "./types";

export const integrationsApi = {
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
};
