import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const makeLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
  }) as unknown as FastifyBaseLogger;

const prismaMock = {
  traktToken: { findUnique: vi.fn(), upsert: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn() },
  item: { upsert: vi.fn() },
  listItem: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
  watchEvent: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(async (operations: unknown[]) => Promise.all(operations)),
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const watchlistMock = { getDefaultWatchlist: vi.fn() };
vi.mock("./watchlist.js", () => watchlistMock);

const seriesProgressMock = { upsertSeriesProgressIfNewer: vi.fn() };
vi.mock("./series-progress.js", () => seriesProgressMock);

const resetMocks = () => {
  vi.resetModules();
  vi.clearAllMocks();
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

    it("keeps an item that disappeared from Trakt, by default", async () => {
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

      expect(result.keptLocally).toBe(1);
      expect(result.removedLocally).toBe(0);
      expect(prismaMock.listItem.delete).not.toHaveBeenCalled();
    });

    it("keeps a kept item in the snapshot so the next sync does not push it back to Trakt", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue({ value: JSON.stringify(["movie:tt5"]) });
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: "watchlist-1", type: "movie", imdbId: "tt5" },
      ]);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);

      const { syncTraktWatchlist } = await import("./trakt-client.js");
      await syncTraktWatchlist(makeLogger(), "profile-1");

      const snapshotWrite = prismaMock.kV.upsert.mock.calls.at(-1)?.[0];
      expect(JSON.parse(snapshotWrite.update.value)).toEqual(["movie:tt5"]);
    });

    it("removes an item locally when mirror deletes are explicitly enabled", async () => {
      process.env.TRAKT_WATCHLIST_MIRROR_DELETES = "true";
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      prismaMock.kV.findUnique.mockResolvedValue({
        value: JSON.stringify(["movie:tt5", "movie:tt6"]),
      });
      watchlistMock.getDefaultWatchlist.mockResolvedValue({ id: "watchlist-1" });
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: "watchlist-1", type: "movie", imdbId: "tt5" },
        { listId: "watchlist-1", type: "movie", imdbId: "tt6" },
      ]);

      // tt6 is still on Trakt, so the watchlist has not "gone empty" — only tt5
      // was genuinely removed there.
      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        const href = url.toString();
        if (href.includes("/sync/watchlist/movies")) {
          return { ok: true, status: 200, headers: new Headers(), json: async () => [movieItem("tt6")] };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
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

    it("refuses to mirror deletions when Trakt reports an empty watchlist, even with mirroring on", async () => {
      process.env.TRAKT_WATCHLIST_MIRROR_DELETES = "true";
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

      expect(result.keptLocally).toBe(1);
      expect(result.removedLocally).toBe(0);
      expect(prismaMock.listItem.delete).not.toHaveBeenCalled();
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

      expect(result).toEqual({ addedLocally: 0, removedLocally: 0, keptLocally: 0, pushedToTrakt: 0 });
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

  describe("pollTraktHistory backfill window", () => {
    const historyUrls = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((href) => href.includes("/sync/history/"));

    // The two KV rows the poll reads answer different questions, so a test that
    // returns one value for every key can't tell them apart.
    const stubKv = (rows: { lastPolledAt?: string; backfilledAt?: string }) => {
      prismaMock.kV.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
        if (where.key === "trakt:lastPolledAt") {
          return rows.lastPolledAt ? { value: rows.lastPolledAt } : null;
        }
        if (where.key === "trakt:historyBackfilledAt") {
          return rows.backfilledAt ? { value: rows.backfilledAt } : null;
        }
        return null;
      });
    };

    const stubEmptyHistory = () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => [] });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("does nothing, quietly, once the Trakt account has been disconnected", async () => {
      // Leaving Trakt is a supported ending. The scheduled poll must not keep
      // throwing at a deleted token and reporting it as a broken sync.
      prismaMock.traktToken.findUnique.mockResolvedValue(null);
      const fetchMock = stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      expect(result.importedWatchEvents).toEqual({ movies: 0, episodes: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prismaMock.kV.upsert).not.toHaveBeenCalled();
    });

    it("imports the entire history — no start_at — when it has never been imported in full", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({});
      const fetchMock = stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      const urls = historyUrls(fetchMock);
      expect(urls).toHaveLength(2);
      for (const href of urls) expect(href).not.toContain("start_at");
      expect(result.since).toBeNull();
      expect(result.fullBackfill).toBe(true);
    });

    it("resumes from the watermark once the history has been imported in full", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({ lastPolledAt: "2026-01-01T00:00:00.000Z", backfilledAt: "2026-01-01T00:00:00.000Z" });
      const fetchMock = stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      for (const href of historyUrls(fetchMock)) {
        expect(href).toContain("start_at=2026-01-01T00%3A00%3A00.000Z");
      }
      expect(result.since).toBe("2026-01-01T00:00:00.000Z");
      expect(result.fullBackfill).toBe(false);
    });

    it("backfills an install that has been polling for a while but never imported the full history", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({ lastPolledAt: "2026-01-01T00:00:00.000Z" });
      const fetchMock = stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      for (const href of historyUrls(fetchMock)) expect(href).not.toContain("start_at");
      expect(result.fullBackfill).toBe(true);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: "trakt:historyBackfilledAt" } })
      );
    });

    it("does not record a completed backfill after a merely incremental poll", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({ lastPolledAt: "2026-01-01T00:00:00.000Z", backfilledAt: "2026-01-01T00:00:00.000Z" });
      stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      await pollTraktHistory(makeLogger(), "profile-1");

      expect(prismaMock.kV.upsert).toHaveBeenCalledTimes(1);
      expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: "trakt:lastPolledAt" } })
      );
    });

    it("ignores the watermark when a full backfill is explicitly requested", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({ lastPolledAt: "2026-01-01T00:00:00.000Z", backfilledAt: "2026-01-01T00:00:00.000Z" });
      const fetchMock = stubEmptyHistory();

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1", { full: true });

      for (const href of historyUrls(fetchMock)) expect(href).not.toContain("start_at");
      expect(result.fullBackfill).toBe(true);
    });

    // Three plays on the row, three plays in the import: the aggregate can go.
    const threeMoviePlays = (ids: number[]) =>
      vi.fn().mockImplementation(async (url: URL) => {
        if (String(url).includes("/sync/history/movies")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              ids.map((id, i) => ({
                id,
                watched_at: `2024-01-0${i + 1}T00:00:00Z`,
                movie: { title: "Qux", ids: { imdb: "tt4" } },
              })),
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });

    it("drops an aggregate play count once the backfill carries every play it stood for", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({});
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      // Only the first entry matches the legacy row by date; the other two are
      // created as their own events.
      prismaMock.watchEvent.findFirst
        .mockResolvedValueOnce({ id: "legacy-1", traktHistoryId: null, plays: 3 })
        .mockResolvedValue(null);
      vi.stubGlobal("fetch", threeMoviePlays([42, 43, 44]));

      const { pollTraktHistory } = await import("./trakt-client.js");
      await pollTraktHistory(makeLogger(), "profile-1");

      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "legacy-1" },
        data: { traktHistoryId: 42n, plays: 1 },
      });
    });

    it("keeps an aggregate play count the backfill cannot account for", async () => {
      // The row stands for three plays but Trakt only reports one — the rest
      // came from local scrobbles that never reached Trakt, or from a backfill
      // cut short by its page cap. Resetting to 1 would delete them.
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({});
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: "legacy-1", traktHistoryId: null, plays: 3 });
      vi.stubGlobal("fetch", threeMoviePlays([42]));

      const { pollTraktHistory } = await import("./trakt-client.js");
      await pollTraktHistory(makeLogger(), "profile-1");

      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "legacy-1" },
        data: { traktHistoryId: 42n },
      });
    });

    it("leaves an aggregate play count alone on an incremental poll", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({ lastPolledAt: "2026-01-01T00:00:00.000Z", backfilledAt: "2026-01-01T00:00:00.000Z" });
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findFirst.mockResolvedValue({ id: "legacy-1", traktHistoryId: null, plays: 3 });

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        if (String(url).includes("/sync/history/movies")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              { id: 42, watched_at: "2026-02-01T00:00:00Z", movie: { title: "Qux", ids: { imdb: "tt4" } } },
            ],
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pollTraktHistory } = await import("./trakt-client.js");
      await pollTraktHistory(makeLogger(), "profile-1");

      expect(prismaMock.watchEvent.update).toHaveBeenCalledWith({
        where: { id: "legacy-1" },
        data: { traktHistoryId: 42n },
      });
    });

    it("upserts a series title once, however many of its episodes the backfill carries", async () => {
      prismaMock.traktToken.findUnique.mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
      stubKv({});
      prismaMock.watchEvent.findUnique.mockResolvedValue(null);
      prismaMock.watchEvent.findFirst.mockResolvedValue(null);

      const fetchMock = vi.fn().mockImplementation(async (url: URL) => {
        if (String(url).includes("/sync/history/episodes")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () =>
              [1, 2, 3].map((n) => ({
                id: 100 + n,
                watched_at: `2024-01-0${n}T00:00:00Z`,
                episode: { season: 1, number: n },
                show: { title: "Show", ids: { imdb: "tt9" } },
              })),
          };
        }
        return { ok: true, status: 200, headers: new Headers(), json: async () => [] };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { pollTraktHistory } = await import("./trakt-client.js");
      const result = await pollTraktHistory(makeLogger(), "profile-1");

      expect(result.importedWatchEvents.episodes).toBe(3);
      expect(prismaMock.item.upsert).toHaveBeenCalledTimes(1);
    });
  });
});
