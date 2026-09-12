/**
 * Everything the Settings page reads and writes that is not a profile or
 * an integration of its own.
 */

import { request } from "./client";
import type {
  AddonCatalogOption,
  AddonConfig,
  JellyseerrStatus,
  JobFailure,
  JobRun,
  OutboundFailure,
  TmdbStatus,
  UserPreferences,
} from "./types";

export const settingsApi = {
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
  setOmdbKey(apiKey: string) {
    return request<{ configured: boolean }>("/omdb/key", {
      method: "POST",
      body: JSON.stringify({ apiKey })
    });
  },
  removeOmdbKey() {
    return request<{ configured: boolean }>("/omdb/key", { method: "DELETE" });
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
  getJobStatus() {
    return request<{ failures: JobFailure[]; runs?: JobRun[] | undefined }>("/settings/job-status");
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
  // Jellyseerr / Overseerr. The API key is write-only: it goes up, and only
  // `hasApiKey` comes back.
  getJellyseerrConfig() {
    return request<JellyseerrStatus>("/settings/jellyseerr");
  },
  saveJellyseerrConfig(payload: {
    url: string;
    apiKey?: string | undefined;
    requestOnAdd?: boolean | undefined;
    cancelOnRemove?: boolean | undefined;
  }) {
    // The server tests the connection before storing it, which is a round trip
    // to a service on someone's LAN rather than to the API.
    return request<JellyseerrStatus>("/settings/jellyseerr", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 30000,
    });
  },
  removeJellyseerrConfig() {
    return request<JellyseerrStatus>("/settings/jellyseerr", { method: "DELETE" });
  },
  testJellyseerr() {
    return request<{
      success: boolean;
      version?: string | null | undefined;
      applicationTitle?: string | null | undefined;
      outcome?: OutboundFailure | undefined;
      error?: string | undefined;
    }>("/settings/jellyseerr/test", { method: "POST", timeoutMs: 30000 });
  },
};
