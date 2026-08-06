import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
};

type GamePayload = Record<string, unknown>;

/**
 * Stubs Twitch + IGDB. `respond` is handed the Apicalypse body of each IGDB
 * request, so a test can answer the fuzzy `search` query and the literal
 * `where name ~ *"…"*` query differently — which is the whole point of there
 * being two of them.
 */
function stubIgdb(respond: (body: string) => GamePayload[]) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = url.toString();
    if (href.includes("id.twitch.tv")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify(respond(String(init?.body ?? ""))), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const isFuzzySearch = (body: string) => body.includes("search ");
const isLiteralSearch = (body: string) => body.includes("name ~");

describe("igdb", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.TWITCH_CLIENT_ID = "client-id";
    process.env.TWITCH_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe("IgdbClient.fromEnv", () => {
    it("throws when Twitch credentials are missing", async () => {
      delete process.env.TWITCH_CLIENT_ID;
      const { IgdbClient } = await import("./igdb.js");
      expect(() => IgdbClient.fromEnv()).toThrow("Twitch credentials are incomplete");
    });

    it("returns a client when credentials are present", async () => {
      const { IgdbClient } = await import("./igdb.js");
      expect(() => IgdbClient.fromEnv()).not.toThrow();
    });
  });

  describe("searchGames", () => {
    it("fetches a Twitch token then queries IGDB, transforming the response", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(
          JSON.stringify([
            {
              id: 1942,
              name: "The Witcher 3: Wild Hunt",
              cover: { image_id: "abc123" },
              first_release_date: 1431993600,
              genres: [{ name: "RPG" }]
            }
          ]),
          { status: 200 }
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      const results = await client.searchGames("witcher 3");

      expect(results).toEqual([
        {
          igdbId: 1942,
          title: "The Witcher 3: Wild Hunt",
          coverUrl: "https://images.igdb.com/igdb/image/upload/t_720p/abc123.jpg",
          releaseDate: "2015-05-19",
          genres: ["RPG"]
        }
      ]);

      const twitchCall = fetchMock.mock.calls.find(([url]) => url.toString().includes("id.twitch.tv"));
      expect(twitchCall).toBeTruthy();
      const igdbCall = fetchMock.mock.calls.find(([url]) => url.toString().includes("api.igdb.com"));
      expect(igdbCall?.[1]).toMatchObject({
        headers: expect.objectContaining({ "Client-ID": "client-id", Authorization: "Bearer tok" })
      });
    });

    it("caches the Twitch token across multiple requests", async () => {
      let tokenRequests = 0;
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          tokenRequests += 1;
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      await client.searchGames("a");
      await client.searchGames("b");

      expect(tokenRequests).toBe(1);
    });

    it("clears the cached token and throws on a 401 from IGDB", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response("invalid token", { status: 401 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();

      await expect(client.searchGames("a")).rejects.toThrow("IGDB request failed (401)");
    });

    it("escapes double quotes in the search query", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      await client.searchGames('Portal 2: "Aperture"');

      const igdbCall = fetchMock.mock.calls.find(([url]) => url.toString().includes("api.igdb.com"));
      expect(igdbCall?.[1]?.body).toContain('search "Portal 2: \\"Aperture\\""');
    });

    it("asks IGDB two different ways: the fuzzy index and a literal name match", async () => {
      const fetchMock = stubIgdb(() => []);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      await IgdbClient.fromEnv().searchGames("super mario sunshine");

      const bodies = fetchMock.mock.calls
        .filter(([url]) => url.toString().includes("api.igdb.com"))
        .map(([, init]) => String(init?.body ?? ""));

      expect(bodies).toHaveLength(2);
      expect(bodies.some((b) => b.includes('search "super mario sunshine"'))).toBe(true);
      const literal = bodies.find(isLiteralSearch);
      expect(literal).toContain('name ~ *"super mario sunshine"*');
      // Editions/regional variants and games nobody has rated are what buried
      // the real answer, so the literal half asks for neither.
      expect(literal).toContain("version_parent = null");
      expect(literal).toContain("total_rating_count != null");
    });

    it("returns a title the fuzzy index missed but the literal name match found", async () => {
      stubIgdb((body) =>
        isFuzzySearch(body)
          ? [{ id: 2, name: "Super Mario Sunshine 128" }]
          : [{ id: 1, name: "Super Mario Sunshine", total_rating_count: 900 }]
      );

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const results = await IgdbClient.fromEnv().searchGames("Super Mario Sunshine");

      expect(results.map((r) => r.title)).toEqual(["Super Mario Sunshine", "Super Mario Sunshine 128"]);
    });

    it("puts the games people mean above the editions IGDB's relevance order leads with", async () => {
      stubIgdb((body) =>
        isFuzzySearch(body)
          ? [
              { id: 10, name: "Super Mario All-Stars: Limited Edition", version_parent: 3, total_rating_count: 1200 },
              { id: 11, name: "The Super Mario Bros. Super Show! 64", total_rating_count: 1 },
              { id: 12, name: "Super Mario Odyssey", total_rating_count: 1500 }
            ]
          : [
              { id: 12, name: "Super Mario Odyssey", total_rating_count: 1500 },
              { id: 13, name: "Super Mario 64", total_rating_count: 900 }
            ]
      );

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const results = await IgdbClient.fromEnv().searchGames("Super Mario");

      // Deduped across both queries and most-rated first within a tier — but
      // the boxed edition drops below both games it out-rates, because a
      // version of a game is never a better answer than a game.
      expect(results.map((r) => r.title)).toEqual([
        "Super Mario Odyssey",
        "Super Mario 64",
        "Super Mario All-Stars: Limited Edition",
        "The Super Mario Bros. Super Show! 64"
      ]);
    });

    it("still answers when one of the two queries fails", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        if (isLiteralSearch(String(init?.body ?? ""))) {
          return new Response("bad filter", { status: 400 });
        }
        return new Response(JSON.stringify([{ id: 1, name: "Hollow Knight" }]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const results = await IgdbClient.fromEnv().searchGames("hollow knight");

      expect(results.map((r) => r.title)).toEqual(["Hollow Knight"]);
    });

    it("throws only when both queries fail", async () => {
      const fetchMock = vi.fn(async (url: string | URL) => {
        if (url.toString().includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response("upstream is down", { status: 503 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();

      await expect(IgdbClient.fromEnv().searchGames("hollow knight")).rejects.toThrow("IGDB request failed (503)");
    });

    it("serves a repeated query from cache instead of spending the rate limit again", async () => {
      const fetchMock = stubIgdb(() => [{ id: 1, name: "Hades", total_rating_count: 500 }]);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      await client.searchGames("Hades");
      // Same search, differently typed — the cache is keyed on the normalized query.
      const second = await client.searchGames("  hades ");

      expect(second.map((r) => r.title)).toEqual(["Hades"]);
      expect(fetchMock.mock.calls.filter(([url]) => url.toString().includes("api.igdb.com"))).toHaveLength(2);
    });

    it("does not cache a half-answer", async () => {
      let literalRequests = 0;
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (url.toString().includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        if (isLiteralSearch(String(init?.body ?? ""))) {
          literalRequests += 1;
          return new Response("bad filter", { status: 400 });
        }
        return new Response(JSON.stringify([{ id: 1, name: "Hades" }]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      await client.searchGames("Hades");
      await client.searchGames("Hades");

      expect(literalRequests).toBe(2);
    });

    it("skips IGDB entirely for a blank query", async () => {
      const fetchMock = stubIgdb(() => []);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const results = await IgdbClient.fromEnv().searchGames("   ");

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rankGameCandidates", () => {
    it("matches on letters and digits, so punctuation in a title is not a worse match", async () => {
      const { rankGameCandidates } = await import("./igdb.js");
      const ranked = rankGameCandidates(
        [
          { id: 1, name: "Super Mario Bros. 3", total_rating_count: 1000 },
          { id: 2, name: "Super Mario Bros.", total_rating_count: 10 }
        ],
        "super mario bros"
      );

      // The exact title wins on tier despite being rated a hundredth as often.
      expect(ranked.map((g) => g.id)).toEqual([2, 1]);
    });

    it("ranks a word-start match above one buried mid-word", async () => {
      const { rankGameCandidates } = await import("./igdb.js");
      const ranked = rankGameCandidates(
        [
          { id: 1, name: "Supermario Kart Clone" },
          { id: 2, name: "The Mario Party" }
        ],
        "mario"
      );

      expect(ranked.map((g) => g.id)).toEqual([2, 1]);
    });

    it("keeps a fuzzy-only hit rather than dropping it", async () => {
      const { rankGameCandidates } = await import("./igdb.js");
      const ranked = rankGameCandidates(
        [
          { id: 1, name: "Doki Doki Literature Club" },
          { id: 2, name: "DDLC Plus", total_rating_count: 50 }
        ],
        "doki doki"
      );

      expect(ranked.map((g) => g.id)).toEqual([1, 2]);
    });

    it("puts an edition below the game it is an edition of", async () => {
      const { rankGameCandidates } = await import("./igdb.js");
      const ranked = rankGameCandidates(
        [
          { id: 20, name: "Super Mario All-Stars", version_parent: 3, total_rating_count: 500 },
          { id: 3, name: "Super Mario All-Stars", total_rating_count: 500 }
        ],
        "Super Mario All-Stars"
      );

      expect(ranked.map((g) => g.id)).toEqual([3, 20]);
    });

    it("keeps one row per game when both queries return it", async () => {
      const { rankGameCandidates } = await import("./igdb.js");
      const ranked = rankGameCandidates(
        [
          { id: 7, name: "Celeste", total_rating_count: 400 },
          { id: 7, name: "Celeste", total_rating_count: 400 }
        ],
        "celeste"
      );

      expect(ranked).toHaveLength(1);
    });
  });

  describe("findBestMatch", () => {
    it("prefers an exact case-insensitive title match over a partial match", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(
          JSON.stringify([
            { id: 2, name: "Portal 2: Aperture Edition" },
            { id: 1, name: "Portal 2" }
          ]),
          { status: 200 }
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      const match = await client.findBestMatch("portal 2");

      expect(match?.igdbId).toBe(1);
    });

    it("returns null when IGDB has no results", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify([]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      const match = await client.findBestMatch("some obscure unmatched title");

      expect(match).toBeNull();
    });

    it("returns null (not the top hit) when results exist but none match by exact or substring title", async () => {
      const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
        void init;
        const href = url.toString();
        if (href.includes("id.twitch.tv")) {
          return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
        }
        return new Response(JSON.stringify([{ id: 99, name: "Totally Unrelated Game" }]), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { IgdbClient, resetIgdbTokenCache } = await import("./igdb.js");
      resetIgdbTokenCache();
      const client = IgdbClient.fromEnv();
      const match = await client.findBestMatch("My Weird Steam Game");

      expect(match).toBeNull();
    });
  });
});
