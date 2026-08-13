import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { deriveServiceToken, SERVICE_TOKEN_HEADER } from "@cataloggy/shared";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";
import { decryptSecret, kvSecretContext } from "../lib/secret-box.js";

const API_TOKEN = "settings-route-token";
const originalApiToken = process.env.API_TOKEN;
/** What the add-on can compute and a browser holding `API_TOKEN` cannot. */
const addonHeaders = { [SERVICE_TOKEN_HEADER]: deriveServiceToken(API_TOKEN) };

const prismaMock = {
  kV: { upsert: vi.fn(), deleteMany: vi.fn() },
};

const getLanguageSetting = vi.fn();
const getRegionSetting = vi.fn();
const getSpoilerProtection = vi.fn();
const getOmdbApiKey = vi.fn();
const getTmdbApiKey = vi.fn();
const getRpdbApiKey = vi.fn();
const getJobRuns = vi.fn();
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
// `failuresFrom` is a pure projection over whatever `getJobRuns` returned, so
// the route is tested against the real one rather than a second copy of it.
vi.mock("../lib/job-status.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/job-status.js")>()),
  getJobRuns: () => getJobRuns(),
}));

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
    getJobRuns.mockResolvedValue([]);
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

    // The route hands the key to the secret store rather than writing it, so
    // this is the check that it actually went that way: with a token to derive
    // from, what lands in the row is ciphertext the key can be read back out of
    // — not the key itself.
    it("stores the key encrypted when API_TOKEN is set", async () => {
      const originalToken = process.env.API_TOKEN;
      process.env.API_TOKEN = "settings-route-token";
      try {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
        const app = await buildApp();

        await app.inject({ method: "POST", url: "/tmdb/key", payload: { apiKey: "abc123" } });

        const stored = prismaMock.kV.upsert.mock.calls[0][0].update.value as string;
        expect(stored).not.toContain("abc123");
        expect(decryptSecret(kvSecretContext("tmdb:apiKey"), stored)).toBe("abc123");
      } finally {
        if (originalToken === undefined) delete process.env.API_TOKEN;
        else process.env.API_TOKEN = originalToken;
      }
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
    // `/rpdb/config` is gated on a token derived from `API_TOKEN`, so this
    // block needs one to derive from.
    beforeEach(() => {
      process.env.API_TOKEN = API_TOKEN;
    });

    afterEach(() => {
      if (originalApiToken === undefined) delete process.env.API_TOKEN;
      else process.env.API_TOKEN = originalApiToken;
    });

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

      const res = await app.inject({ method: "GET", url: "/rpdb/config", headers: addonHeaders });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, apiKey: "rpdb-key" });
    });

    it("reports no key rather than failing when RPDB is unconfigured", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/rpdb/config", headers: addonHeaders });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, apiKey: null });
    });

    // This is the only route that hands a stored third-party key back out, and
    // the browser holds the same `API_TOKEN` the add-on does — so an XSS'd tab
    // could read it. Settings reads `/rpdb/status`, which says only whether one
    // is configured.
    it("does not exist for a caller that only holds API_TOKEN", async () => {
      getRpdbApiKey.mockResolvedValue("rpdb-key");
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/rpdb/config" });

      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("rpdb-key");
    });

    it("does not accept API_TOKEN itself as the add-on's proof", async () => {
      getRpdbApiKey.mockResolvedValue("rpdb-key");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/rpdb/config",
        headers: { [SERVICE_TOKEN_HEADER]: API_TOKEN },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /settings/job-status", () => {
    it("reports failing background jobs", async () => {
      getJobRuns.mockResolvedValue([
        {
          job: "steam-sync",
          status: "failed",
          message: "Steam API returned 503",
          durationMs: 120,
          overran: false,
          at: "2026-01-01T00:00:00.000Z",
        },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/job-status" });

      expect(res.statusCode).toBe(200);
      expect(res.json().failures).toEqual([
        { job: "steam-sync", message: "Steam API returned 503", failedAt: "2026-01-01T00:00:00.000Z" },
      ]);
    });

    it("reports a job that outran its interval, which is no failure at all", async () => {
      // The scheduler drops the tick such a run collided with, so the job is
      // quietly running less often than it was configured to — invisible from
      // the failure list, since nothing failed.
      getJobRuns.mockResolvedValue([
        {
          job: "trakt-history-poll",
          status: "ok",
          message: null,
          durationMs: 900_000,
          overran: true,
          at: "2026-01-01T00:00:00.000Z",
        },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/job-status" });

      expect(res.json().failures).toEqual([]);
      expect(res.json().runs).toEqual([expect.objectContaining({ job: "trakt-history-poll", overran: true })]);
    });

    it("reports an empty list when every job is healthy", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/settings/job-status" });

      expect(res.json()).toEqual({ failures: [], runs: [] });
    });
  });
});
