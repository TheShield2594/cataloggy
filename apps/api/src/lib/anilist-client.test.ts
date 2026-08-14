import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real `Response`s rather than a stand-in object: requests go through the
// shared outbound policy, which reads `Retry-After` off the headers and
// cancels the body of a response it is about to retry.
const mockFetchOnce = (body: unknown, status = 200) => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("anilist-client", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("searchAnime", () => {
    it("returns an empty array for a blank query without calling fetch", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const { searchAnime } = await import("./anilist-client.js");
      expect(await searchAnime("   ")).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("maps AniList media into simplified search results", async () => {
      mockFetchOnce({
        data: {
          Page: {
            media: [
              {
                id: 1,
                episodes: 24,
                coverImage: { large: "https://example.com/cover.jpg" },
                title: { english: "Cowboy Bebop", romaji: "Cowboy Bebop", native: null },
              },
            ],
          },
        },
      });

      const { searchAnime } = await import("./anilist-client.js");
      const results = await searchAnime("cowboy bebop");
      expect(results).toEqual([
        { id: 1, title: "Cowboy Bebop", episodes: 24, coverImage: "https://example.com/cover.jpg" },
      ]);
    });

    it("falls back to romaji or native title when english is missing", async () => {
      mockFetchOnce({
        data: {
          Page: {
            media: [
              { id: 2, episodes: null, coverImage: { large: null }, title: { english: null, romaji: "Shingeki", native: null } },
            ],
          },
        },
      });

      const { searchAnime } = await import("./anilist-client.js");
      const results = await searchAnime("attack on titan");
      expect(results[0].title).toBe("Shingeki");
    });

    it("retries a non-OK response and throws once the retries run out", async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = mockFetchOnce({}, 500);
        const { searchAnime } = await import("./anilist-client.js");

        const search = searchAnime("test");
        const assertion = expect(search).rejects.toThrow("AniList request failed with status 500");
        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("throws when AniList returns GraphQL errors", async () => {
      mockFetchOnce({ errors: [{ message: "Invalid request" }] });
      const { searchAnime } = await import("./anilist-client.js");
      await expect(searchAnime("test")).rejects.toThrow("Invalid request");
    });
  });

  describe("getAnimeById", () => {
    it("maps a single media entry into anime details", async () => {
      mockFetchOnce({
        data: {
          Media: {
            id: 5,
            episodes: 12,
            format: "TV",
            coverImage: { large: "https://example.com/x.jpg" },
            title: { english: "Test Anime", romaji: "Tesuto Anime", native: null },
          },
        },
      });

      const { getAnimeById } = await import("./anilist-client.js");
      const result = await getAnimeById(5);
      expect(result).toEqual({
        id: 5,
        title: "Test Anime",
        episodes: 12,
        coverImage: "https://example.com/x.jpg",
        format: "TV",
      });
    });

    it("returns null when AniList has no matching media", async () => {
      mockFetchOnce({ data: { Media: null } });
      const { getAnimeById } = await import("./anilist-client.js");
      expect(await getAnimeById(999)).toBeNull();
    });
  });

  describe("toAbsoluteEpisodeNumbering", () => {
    it("clamps episode numbers within the anime's total episode count", async () => {
      const { toAbsoluteEpisodeNumbering } = await import("./anilist-client.js");
      const numbering = toAbsoluteEpisodeNumbering({
        id: 1, title: "Test", episodes: 12, coverImage: null, format: "TV",
      });
      expect(numbering.totalEpisodes).toBe(12);
      expect(numbering.absoluteEpisode(5)).toBe(5);
      expect(numbering.absoluteEpisode(15)).toBe(12);
      expect(numbering.absoluteEpisode(0)).toBe(1);
    });

    it("passes through the requested episode when total episodes is unknown", async () => {
      const { toAbsoluteEpisodeNumbering } = await import("./anilist-client.js");
      const numbering = toAbsoluteEpisodeNumbering({
        id: 1, title: "Test", episodes: null, coverImage: null, format: "TV",
      });
      expect(numbering.totalEpisodes).toBe(0);
      expect(numbering.absoluteEpisode(7)).toBe(7);
    });

    it("clamps to 1 even when total episodes is unknown", async () => {
      const { toAbsoluteEpisodeNumbering } = await import("./anilist-client.js");
      const numbering = toAbsoluteEpisodeNumbering({
        id: 1, title: "Test", episodes: null, coverImage: null, format: "TV",
      });
      expect(numbering.absoluteEpisode(0)).toBe(1);
      expect(numbering.absoluteEpisode(-5)).toBe(1);
    });
  });
});
