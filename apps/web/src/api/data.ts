/**
 * Getting your data out, and getting someone else's in.
 */

import { request } from "./client";
import type {
  ExportPayload,
  ImportSummary,
} from "./types";

export const dataApi = {
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
};
