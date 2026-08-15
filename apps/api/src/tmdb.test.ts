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

    it("re-asks about a missing IMDb id sooner than about a known one", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          if (!input.pathname.endsWith("/external_ids")) return json(searchPage(2));
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: id === 2 ? null : `tt000${id}` });
        })
      );

      const { TmdbClient } = await import("./tmdb.js");
      const { externalIdsCache, EXTERNAL_IDS_MISS_CACHE_TTL_MS } = await import("./lib/cache.js");
      await TmdbClient.fromKey("key").popular(MetadataType.movie);

      // The answer that decides whether a title is findable at all is also the
      // one most likely to be corrected on TMDB, so it is held far more briefly.
      expect(externalIdsCache.getRemainingTTL("movie:2")).toBeLessThanOrEqual(EXTERNAL_IDS_MISS_CACHE_TTL_MS);
      expect(externalIdsCache.getRemainingTTL("movie:1")).toBeGreaterThan(EXTERNAL_IDS_MISS_CACHE_TTL_MS);
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

  describe("search", () => {
    /** A page of titles, each keyed to its own id so the mocks can pick them apart. */
    const titles = (entries: { id: number; title: string }[], totalPages = 1) => ({
      page: 1,
      total_pages: totalPages,
      results: entries.map((entry) => ({ ...entry, name: entry.title, release_date: "2020-01-01" })),
    });

    const listRequests = (fetchMock: { mock: { calls: unknown[][] } }) =>
      fetchMock.mock.calls
        .map(([input]) => input as URL)
        .filter((url) => url.pathname.startsWith("/3/search/") || url.pathname.startsWith("/3/find/"));

    it("pages past the first when results are lost to missing IMDb ids", async () => {
      // Only five of page one's twenty are titles TMDB knows an IMDb id for,
      // which is the case a single page cannot answer: the other fifteen are
      // dropped and the search comes back a quarter full.
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) {
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: id <= 5 || id > 20 ? `tt${String(id).padStart(4, "0")}` : null });
        }
        const page = Number(input.searchParams.get("page"));
        const offset = (page - 1) * 20;
        return json(
          titles(
            Array.from({ length: 20 }, (_, i) => ({ id: offset + i + 1, title: `Show ${offset + i + 1}` })),
            3
          )
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(MetadataType.series, "show");

      expect(results).toHaveLength(20);
      expect(listRequests(fetchMock).map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    });

    it("stops at one page when the first one already fills the search", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) {
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: `tt${String(id).padStart(4, "0")}` });
        }
        return json(
          titles(Array.from({ length: 20 }, (_, i) => ({ id: i + 1, title: `Show ${i + 1}` })), 9)
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(MetadataType.movie, "show");

      expect(results).toHaveLength(20);
      expect(listRequests(fetchMock)).toHaveLength(1);
    });

    it("puts an exact title match first, even when TMDB ranked it onto page two", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) {
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: `tt000${id}` });
        }
        return json(
          Number(input.searchParams.get("page")) === 1
            ? titles([{ id: 1, title: "The Thing About Pam" }, { id: 2, title: "The Thing Called Love" }], 2)
            : titles([{ id: 3, title: "The Thing" }], 2)
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(MetadataType.movie, "the thing");

      expect(results.map((r) => r.name)).toEqual([
        "The Thing",
        "The Thing About Pam",
        "The Thing Called Love",
      ]);
    });

    it("answers a person's name with what they are known for", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) {
          const id = Number(input.pathname.split("/")[3]);
          return json({ imdb_id: `tt000${id}` });
        }
        if (input.pathname.endsWith("/search/person")) {
          return json({
            results: [
              {
                id: 1,
                name: "Denis Villeneuve",
                known_for: [
                  { id: 11, title: "Dune", media_type: "movie", release_date: "2021-01-01" },
                  { id: 12, name: "Some Series", media_type: "tv", first_air_date: "2019-01-01" },
                  { id: 13, title: "Arrival", media_type: "movie", release_date: "2016-01-01" },
                ],
              },
            ],
          });
        }
        return json(titles([]));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(MetadataType.movie, "villeneuve");

      // The series credit is not a movie, so it is not one of this search's answers.
      expect(results.map((r) => r.name)).toEqual(["Dune", "Arrival"]);
    });

    it("does not go looking for people when the query matched titles", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) return json({ imdb_id: "tt0001" });
        return json(titles([{ id: 1, title: "Dune" }]));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      await TmdbClient.fromKey("key").search(MetadataType.movie, "dune");

      expect(fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/search/person"))).toBe(false);
    });

    it("resolves a pasted IMDb id rather than searching for the literal string", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.startsWith("/3/find/")) {
          return json({ movie_results: [{ id: 680, title: "Pulp Fiction", release_date: "1994-10-14" }] });
        }
        return json(titles([]));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(MetadataType.movie, "tt0110912");

      expect(results).toEqual([expect.objectContaining({ imdbId: "tt0110912", name: "Pulp Fiction" })]);
      expect(listRequests(fetchMock).map((url) => url.pathname)).toEqual(["/3/find/tt0110912"]);
    });

    it("resolves a pasted themoviedb.org link", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) return json({ imdb_id: "tt0110912" });
        return json({ id: 680, title: "Pulp Fiction", release_date: "1994-10-14", runtime: 154 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const results = await TmdbClient.fromKey("key").search(
        MetadataType.movie,
        "https://www.themoviedb.org/movie/680-pulp-fiction"
      );

      expect(results).toEqual([
        expect.objectContaining({ imdbId: "tt0110912", name: "Pulp Fiction", runtime: 154 }),
      ]);
    });

    it("serves a repeated search from cache instead of fanning out again", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) return json({ imdb_id: "tt0001" });
        return json(titles([{ id: 1, title: "Dune" }]));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const client = TmdbClient.fromKey("key");

      const first = await client.search(MetadataType.movie, "dune");
      const second = await client.search(MetadataType.movie, "Dune");

      expect(second).toEqual(first);
      expect(listRequests(fetchMock)).toHaveLength(1);
    });

    it("collapses searches that are already in flight into one", async () => {
      const fetchMock = vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("/external_ids")) return json({ imdb_id: "tt0001" });
        await new Promise((resolve) => setTimeout(resolve, 0));
        return json(titles([{ id: 1, title: "Dune" }]));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { TmdbClient } = await import("./tmdb.js");
      const client = TmdbClient.fromKey("key");

      const [first, second] = await Promise.all([
        client.search(MetadataType.movie, "dune"),
        client.search(MetadataType.movie, "dune"),
      ]);

      expect(second).toEqual(first);
      expect(listRequests(fetchMock)).toHaveLength(1);
    });
  });
});
