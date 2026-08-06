import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const prismaMock = {
  kV: { upsert: vi.fn(), deleteMany: vi.fn() },
};

const getLanguageSetting = vi.fn();
const getRegionSetting = vi.fn();
const getSpoilerProtection = vi.fn();
const getOmdbApiKey = vi.fn();
const getTmdbApiKey = vi.fn();
const getRpdbApiKey = vi.fn();
const getFailedJobStatuses = vi.fn();
const trendingCacheClear = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/settings.js", () => ({
  LANGUAGE_KV_KEY: "settings:language",
  REGION_KV_KEY: "settings:region",
  SPOILER_PROTECTION_KV_KEY: "settings:spoilerProtection",
  getLanguageSetting: () => getLanguageSetting(),
  getRegionSetting: () => getRegionSetting(),
  getSpoilerProtection: () => getSpoilerProtection(),
}));
vi.mock("../lib/omdb.js", () => ({
  OMDB_API_KEY_KV: "omdb:apiKey",
  getOmdbApiKey: () => getOmdbApiKey(),
}));
vi.mock("../lib/tmdb-client.js", () => ({
  TMDB_API_KEY_KV: "tmdb:apiKey",
  getTmdbApiKey: () => getTmdbApiKey(),
}));
vi.mock("../lib/rpdb.js", () => ({
  RPDB_API_KEY_KV: "rpdb:apiKey",
  getRpdbApiKey: () => getRpdbApiKey(),
}));
vi.mock("../lib/cache.js", () => ({ trendingCache: { clear: () => trendingCacheClear() } }));
vi.mock("../lib/job-status.js", () => ({ getFailedJobStatuses: () => getFailedJobStatuses() }));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./settings.js"));

describe("settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLanguageSetting.mockResolvedValue("en-US");
    getRegionSetting.mockResolvedValue("US");
    getSpoilerProtection.mockResolvedValue(false);
    getTmdbApiKey.mockResolvedValue({ apiKey: null, source: "none" });
    getOmdbApiKey.mockResolvedValue(null);
    getRpdbApiKey.mockResolvedValue(null);
    getFailedJobStatuses.mockResolvedValue([]);
    prismaMock.kV.upsert.mockResolvedValue({});
    prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("GET /settings/preferences", () => {
    it("returns the stored preferences alongside the provider catalogue", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/preferences" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ language: "en-US", region: "US", spoilerProtection: false });
      expect(body.availableProviders).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: "netflix", name: "Netflix" })])
      );
    });
  });

  describe("POST /settings/preferences", () => {
    it("normalizes the casing of a language tag before storing it", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { language: "EN-us" },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "settings:language" },
          update: expect.objectContaining({ value: "en-US" }),
        })
      );
    });

    it("accepts a bare language without a region subtag", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { language: "fr" },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ value: "fr" }) })
      );
    });

    it("rejects a malformed language tag", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { language: "english" },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
    });

    it("uppercases a region code", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { region: "gb" },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "settings:region" },
          update: expect.objectContaining({ value: "GB" }),
        })
      );
    });

    it("rejects a region that is not two letters", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { region: "USA" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("stores spoiler protection when it is switched off", async () => {
      // `false` is a real value here, not an absent one — a truthiness check
      // would silently drop it.
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/settings/preferences",
        payload: { spoilerProtection: false },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "settings:spoilerProtection" },
          update: expect.objectContaining({ value: "false" }),
        })
      );
    });

    it("clears the trending cache so cached rows pick up the new region", async () => {
      const app = await buildApp();

      await app.inject({ method: "POST", url: "/settings/preferences", payload: { region: "GB" } });

      expect(trendingCacheClear).toHaveBeenCalled();
    });
  });

  describe("TMDB key", () => {
    it("saves a key that TMDB accepts", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tmdb/key", payload: { apiKey: " abc123 " } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: true, source: "db" });
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ value: "abc123" }) })
      );
    });

    it("refuses to overwrite a working key with one TMDB rejects", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tmdb/key", payload: { apiKey: "bad" } });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/rejected/i);
      expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
    });

    it("reports a validation failure when TMDB is unreachable", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tmdb/key", payload: { apiKey: "abc" } });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/could not reach/i);
    });

    it("rejects an empty key", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tmdb/key", payload: { apiKey: "   " } });

      expect(res.statusCode).toBe(400);
    });

    it("reports the env fallback that remains after the saved key is deleted", async () => {
      getTmdbApiKey.mockResolvedValue({ apiKey: "from-env", source: "env" });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: "/tmdb/key" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: true, source: "env" });
    });
  });

  describe("OMDB key", () => {
    it("deletes the stored key when an empty value is posted", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/omdb/key", payload: { apiKey: "" } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: false });
      expect(prismaMock.kV.deleteMany).toHaveBeenCalledWith({ where: { key: "omdb:apiKey" } });
    });

    it("surfaces OMDB's own error message for a bad key", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ json: async () => ({ Response: "False", Error: "Invalid API key!" }) })
      );
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/omdb/key", payload: { apiKey: "bad" } });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Invalid API key!");
    });

    it("saves a key OMDB accepts", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ Response: "True" }) }));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/omdb/key", payload: { apiKey: "good" } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: true });
    });
  });

  describe("RPDB", () => {
    it("stores a key without calling out to validate it", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/rpdb/key", payload: { apiKey: "rpdb-key" } });

      expect(res.statusCode).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // The per-title poster route was removed as unused; this keeps it removed.
    it("has no per-title poster route, even with a key configured", async () => {
      getRpdbApiKey.mockResolvedValue("rpdb-key");
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/rpdb/poster/tt1" });

      expect(res.statusCode).toBe(404);
    });

    it("reports the key to the add-on, which builds poster URLs itself", async () => {
      getRpdbApiKey.mockResolvedValue("rpdb-key");
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/rpdb/config" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, apiKey: "rpdb-key" });
    });

    it("reports no key rather than failing when RPDB is unconfigured", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/rpdb/config" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, apiKey: null });
    });
  });

  describe("GET /settings/job-status", () => {
    it("reports failing background jobs", async () => {
      getFailedJobStatuses.mockResolvedValue([
        { job: "steam-sync", message: "Steam API returned 503", failedAt: "2026-01-01T00:00:00.000Z" },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/job-status" });

      expect(res.statusCode).toBe(200);
      expect(res.json().failures).toHaveLength(1);
    });

    it("reports an empty list when every job is healthy", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/job-status" });

      expect(res.json()).toEqual({ failures: [] });
    });
  });
});
