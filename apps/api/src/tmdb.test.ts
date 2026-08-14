import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataType } from "@prisma/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const searchPage = (count: number) => ({
  results: Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Show ${i + 1}`,
    title: `Show ${i + 1}`,
    first_air_date: "2020-01-01",
  })),
});

describe("TmdbClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("catalog fan-out", () => {
    it("resolves an IMDb id per result without firing them all at once", async () => {
      let inFlight = 0;
      let peakExternalIds = 0;

      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          if (!input.pathname.endsWith("/external_ids")) return json(searchPage(20));

          inFlight += 1;
          peakExternalIds = Math.max(peakExternalIds, inFlight);
          // Yield, so every lookup the client was willing to start is in
          // flight together before the first one answers.
          await new Promise((resolve) => setTimeout(resolve, 0));
          inFlight -= 1;
          const id = input.pathname.split("/")[3];
          return json({ imdb_id: `tt000${id}` });
        })
      );

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").trending(MetadataType.series);

      expect(results).toHaveLength(20);
      expect(results[0].imdbId).toBe("tt0001");
      expect(peakExternalIds).toBeGreaterThan(1);
      expect(peakExternalIds).toBeLessThanOrEqual(5);
    });

    it("drops results TMDB knows no IMDb id for", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          if (!input.pathname.endsWith("/external_ids")) return json(searchPage(3));
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: id === 2 ? null : `tt000${id}` });
        })
      );

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").popular(MetadataType.movie);

      expect(results.map((r) => r.imdbId)).toEqual(["tt0001", "tt0003"]);
    });

    it("drops a result whose lookup failed rather than emptying the catalog", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          if (!input.pathname.endsWith("/external_ids")) return json(searchPage(3));
          const id = Number(input.pathname.split("/")[3]);
          // 404 is not retried, so this is one lookup that is not coming back.
          return id === 2 ? json({ status_message: "Not found" }, 404) : json({ imdb_id: `tt000${id}` });
        })
      );

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").popular(MetadataType.movie);

      expect(results.map((r) => r.imdbId)).toEqual(["tt0001", "tt0003"]);
    });
  });

  describe("throttling", () => {
    it("retries a 429 instead of surfacing an empty catalog", async () => {
      let throttled = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          if (input.pathname.endsWith("/external_ids")) return json({ imdb_id: "tt0001" });
          if (throttled < 2) {
            throttled += 1;
            return json({ status_message: "Your request count is over the allowed limit" }, 429);
          }
          return json(searchPage(1));
        })
      );

      vi.useFakeTimers();
      try {
        const { TmdbClient } = await import("./tmdb.js");
        const pending = TmdbClient.fromKey("key").popular(MetadataType.movie);
        await vi.runAllTimersAsync();

        expect(await pending).toHaveLength(1);
        expect(throttled).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports the status when the throttling outlasts the retries", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json({}, 429)));

      vi.useFakeTimers();
      try {
        const { TmdbClient } = await import("./tmdb.js");
        const pending = TmdbClient.fromKey("key").popular(MetadataType.movie);
        const assertion = expect(pending).rejects.toThrow("TMDB request failed (429)");
        await vi.runAllTimersAsync();
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
