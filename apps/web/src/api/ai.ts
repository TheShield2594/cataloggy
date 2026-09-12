/**
 * The optional LLM provider, and the recommendations it produces.
 */

import { request } from "./client";
import type {
  MediaType,
  OutboundFailure,
  TrendingMeta,
} from "./types";

export const aiApi = {
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
    return request<{ success: boolean; response?: string | undefined; outcome?: OutboundFailure | undefined; error?: string | undefined }>("/ai/test", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
  },
  refreshAiRecs() {
    return request<{ refreshed: boolean }>("/recommendations/ai/refresh", { method: "POST", timeoutMs: 60000 });
  },
  getAiRecommendations(type: MediaType, limit = 20) {
    return request<{ metas: TrendingMeta[]; reasons?: Record<string, string> | undefined }>(`/recommendations/ai?type=${type}&limit=${limit}`);
  },
};
