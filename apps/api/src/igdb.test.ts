import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
};

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
