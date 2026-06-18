import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const makeLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as FastifyBaseLogger;

const prismaMock = {
  traktToken: { findUnique: vi.fn(), upsert: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn() },
  item: { upsert: vi.fn() },
  listItem: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  watchEvent: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const watchlistMock = { getDefaultWatchlist: vi.fn() };
vi.mock("./watchlist.js", () => watchlistMock);

const seriesProgressMock = { upsertSeriesProgressIfNewer: vi.fn() };
vi.mock("./series-progress.js", () => seriesProgressMock);

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
  prismaMock.traktToken.findUnique.mockReset();
  prismaMock.traktToken.upsert.mockReset();
  prismaMock.kV.findUnique.mockReset();
  prismaMock.kV.upsert.mockReset();
  prismaMock.item.upsert.mockReset();
  prismaMock.listItem.findMany.mockReset();
  prismaMock.listItem.create.mockReset();
  prismaMock.listItem.delete.mockReset();
  prismaMock.watchEvent.update.mockReset();
  prismaMock.watchEvent.findUnique.mockReset();
  prismaMock.watchEvent.findFirst.mockReset();
  prismaMock.watchEvent.create.mockReset();
  watchlistMock.getDefaultWatchlist.mockReset();
  seriesProgressMock.upsertSeriesProgressIfNewer.mockReset();
};

describe("trakt-client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMocks();
    process.env.TRAKT_CLIENT_ID = "client-id";
    process.env.TRAKT_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  describe("isTraktConnected", () => {
    it("returns false when credentials are not configured", async () => {
      delete process.env.TRAKT_CLIENT_ID;
      vi.resetModules();
      const { isTraktConnected } = await import("./trakt-client.js");
      expect(await isTraktConnected()).toBe(false);
      expect(prismaMock.traktToken.findUnique).not.toHaveBeenCalled();
    });

    it("returns false when no token row exists", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue(null);
      const { isTraktConnected } = await import("./trakt-client.js");
      expect(await isTraktConnected()).toBe(false);
    });

    it("returns true when a token row exists", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ id: "default" });
      const { isTraktConnected } = await import("./trakt-client.js");
      expect(await isTraktConnected()).toBe(true);
    });
  });

  describe("pushTraktScrobble", () => {
    it("returns null without calling Trakt for an episode missing season/episode", async () => {
      const { pushTraktScrobble } = await import("./trakt-client.js");
      const result = await pushTraktScrobble(
        "start",
        { type: "episode", imdbId: "tt1", progress: 50 },
        makeLogger()
      );
      expect(result).toBeNull();
      expect(prismaMock.traktToken.findUnique).not.toHaveBeenCalled();
    });

    it("returns null when Trakt is not connected", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue(null);
      const { pushTraktScrobble } = await import("./trakt-client.js");
      const result = await pushTraktScrobble("start", { type: "movie", imdbId: "tt1", progress: 50 }, makeLogger());
      expect(result).toBeNull();
    });

    it("returns null and logs a warning when the Trakt request throws", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);

      const { pushTraktScrobble } = await import("./trakt-client.js");
      const logger = makeLogger();
      const result = await pushTraktScrobble("start", { type: "movie", imdbId: "tt1", progress: 50 }, logger);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns the Trakt history id on a successful stop", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({
        accessToken: "at",
        refreshToken: "rt",
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ id: 12345 }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pushTraktScrobble } = await import("./trakt-client.js");
      const result = await pushTraktScrobble("stop", { type: "movie", imdbId: "tt1", progress: 100 }, makeLogger());

      expect(result).toBe(12345n);
    });
  });

  describe("token refresh on 401", () => {
    it("refreshes the access token once and retries the original request", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({
        accessToken: "stale-token",
        refreshToken: "refresh-token",
      });
      prismaMock.traktToken.upsert.mockResolvedValue({});

      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async (url: URL | string) => {
        const href = url.toString();
        callCount += 1;
        if (href.includes("/oauth/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "fresh-token", refresh_token: "fresh-refresh", expires_in: 3600 }),
          };
        }
        if (callCount === 1) {
          // first attempt: unauthorized
          return { ok: false, status: 401, headers: new Headers(), text: async () => "unauthorized" };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: 1 }) };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pushTraktScrobble } = await import("./trakt-client.js");
      const result = await pushTraktScrobble("stop", { type: "movie", imdbId: "tt1", progress: 100 }, makeLogger());

      expect(result).toBe(1n);
      expect(prismaMock.traktToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ accessToken: "fresh-token", refreshToken: "fresh-refresh" }),
        })
      );
      // oauth/token + original (401) + retried original = 3 fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("does not retry a second time if the retried request also 401s", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({
        accessToken: "stale-token",
        refreshToken: "refresh-token",
      });
      prismaMock.traktToken.upsert.mockResolvedValue({});

      const fetchMock = vi.fn().mockImplementation(async (url: URL | string) => {
        const href = url.toString();
        if (href.includes("/oauth/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "fresh-token", refresh_token: "fresh-refresh" }),
          };
        }
        return { ok: false, status: 401, headers: new Headers(), text: async () => "still unauthorized" };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pushTraktScrobble } = await import("./trakt-client.js");
      const logger = makeLogger();
      const result = await pushTraktScrobble("stop", { type: "movie", imdbId: "tt1", progress: 100 }, logger);

      // The underlying request throws (still 401, allowRefresh: false), pushTraktScrobble swallows it.
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("pagination limits", () => {
    it("stops fetching once the page-count header is reached", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const page = Number(new URL(url).searchParams.get("page"));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "x-pagination-page-count": "2" }),
          json: async () => [{ movie: { ids: { imdb: `tt${page}` } } }],
        };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { getTraktClient } = await import("./trakt-client.js");
      const client = await getTraktClient();
      const result = await client.fetchWatchlistMovies(makeLogger());

      expect(result).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("warns and stops at the configured max pages even if more pages are reported", async () => {
      process.env.TRAKT_POLL_MAX_PAGES = "1";
      vi.resetModules();
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "x-pagination-page-count": "5" }),
        json: async () => [{ movie: { ids: { imdb: "tt1" } } }],
      });
      vi.stubGlobal("fetch", fetchMock);

      const { getTraktClient } = await import("./trakt-client.js");
      const client = await getTraktClient();
      const logger = makeLogger();
      const result = await client.fetchMovieHistory(logger, "2020-01-01T00:00:00Z");

      expect(result).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/sync/history/movies" }),
        "Reached maximum Trakt pagination limit"
      );
    });

    it("falls back to length-based pagination when no page-count header is present", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });

      let call = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        call += 1;
        const items = call === 1 ? new Array(100).fill({ movie: { ids: { imdb: "tt1" } } }) : [{ movie: { ids: { imdb: "tt2" } } }];
        return { ok: true, status: 200, headers: new Headers(), json: async () => items };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { getTraktClient } = await import("./trakt-client.js");
      const client = await getTraktClient();
      const result = await client.fetchWatchlistMovies(makeLogger());

      expect(result).toHaveLength(101);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("syncTraktWatchlist — resurrection-bug regression", () => {
    const movieItem = (imdbId: string) => ({ movie: { ids: { imdb: imdbId } } });

    it("does not resurrect an item locally when its removal push to Trakt previously failed", async () => {
      // Previous snapshot included tt1 (it was on Trakt and local last sync).
      // Trakt still reports tt1 (the removal push failed last time), but the
      // user has since removed it locally. The sync must retry the removal
      // push, not silently re-add it to the local watchlist.
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue({
        value: JSON.stringify(["movie:tt1"]),
      });
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([]); // nothing local now

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/watchlist/movies")) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [movieItem("tt1")] };
        }
        if (href.includes("/sync/watchlist/shows")) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
        }
        if (href.includes("/sync/watchlist/remove")) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { syncTraktWatchlist } = await import("./trakt-client.js");
      const result = await syncTraktWatchlist(makeLogger(), "profile-1");

      expect(result.addedLocally).toBe(0);
      expect(result.pushedToTrakt).toBe(1);
      expect(prismaMock.item.upsert).not.toHaveBeenCalled();
      expect(prismaMock.listItem.create).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ href: expect.stringContaining("/sync/watchlist/remove") }),
        expect.anything()
      );
    });

    it("adds a genuinely new Trakt item locally when there is no prior snapshot entry for it", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue(null); // no previous snapshot at all
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([]);
      prismaMock.item.upsert.mockResolvedValue({});
      prismaMock.listItem.create.mockResolvedValue({});

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/watchlist/movies")) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [movieItem("tt9")] };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { syncTraktWatchlist } = await import("./trakt-client.js");
      const result = await syncTraktWatchlist(makeLogger(), "profile-1");

      expect(result.addedLocally).toBe(1);
      expect(prismaMock.listItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ imdbId: "tt9" }) })
      );
    });

    it("removes an item locally when it disappeared from Trakt and was present in the previous snapshot", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue({ value: JSON.stringify(["movie:tt5"]) });
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: "watchlist-1", type: "movie", imdbId: "tt5" },
      ]);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const { syncTraktWatchlist } = await import("./trakt-client.js");
      const result = await syncTraktWatchlist(makeLogger(), "profile-1");

      expect(result.removedLocally).toBe(1);
      expect(prismaMock.listItem.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { listId_type_imdbId: { listId: "watchlist-1", type: "movie", imdbId: "tt5" } },
        })
      );
    });

    it("pushes a locally-added item to Trakt when it wasn't in the previous snapshot at all", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue({ value: JSON.stringify([]) });
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: "watchlist-1", type: "movie", imdbId: "tt7" },
      ]);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const { syncTraktWatchlist } = await import("./trakt-client.js");
      const result = await syncTraktWatchlist(makeLogger(), "profile-1");

      expect(result.pushedToTrakt).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.objectContaining({ href: expect.stringContaining("/sync/watchlist") }),
        expect.anything()
      );
    });

    it("returns zero counts and does not touch the database when Trakt is not connected", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue(null);
      const { syncTraktWatchlist } = await import("./trakt-client.js");

      const result = await syncTraktWatchlist(makeLogger(), "profile-1");

      expect(result).toEqual({ addedLocally: 0, removedLocally: 0, pushedToTrakt: 0 });
      expect(watchlistMock.getDefaultWatchlist).not.toHaveBeenCalled();
    });
  });

  describe("pollTraktHistory dedup", () => {
    it("does not duplicate an already-imported history entry on re-poll", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findUnique.mockResolvedValue({ id: "existing-1", traktHistoryId: 555n });

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/history/movies")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              { id: 555, watched_at: "2024-01-01T00:00:00Z", movie: { title: "Foo", ids: { imdb: "tt1" } } },
            ],
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      expect(result.importedWatchEvents.movies).toBe(1);
      expect(prismaMock.watchEvent.create).not.toHaveBeenCalled();
    });

    it("creates a new watch event for a history entry not seen before", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/history/movies")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              { id: 999, watched_at: "2024-01-01T00:00:00Z", movie: { title: "Bar", ids: { imdb: "tt2" } } },
            ],
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      expect(result.importedWatchEvents.movies).toBe(1);
      expect(prismaMock.watchEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ imdbId: "tt2", traktHistoryId: 999n }) })
      );
    });

    it("backfills a legacy event (matched by date, no traktHistoryId) instead of duplicating it", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: "legacy-1", traktHistoryId: null });

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/history/movies")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              { id: 777, watched_at: "2024-01-01T00:00:00Z", movie: { title: "Baz", ids: { imdb: "tt3" } } },
            ],
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pollTraktHistory } = await import("./trakt-client.js");
      await pollTraktHistory(makeLogger(), "profile-1");

      expect(prismaMock.watchEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "legacy-1" },
        data: { traktHistoryId: 777n },
      });
    });
  });
});
