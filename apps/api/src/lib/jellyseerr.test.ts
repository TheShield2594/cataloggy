import { beforeEach, describe, expect, it, vi } from "vitest";
import { first } from "./test-fixtures/present.js";

const fetchWithPolicy = vi.fn();
const readSecretKv = vi.fn();
const writeSecretKv = vi.fn();
const resolveNotificationUrl = vi.fn();
const findUnique = vi.fn();
const findByImdbId = vi.fn();
const recordJobFailure = vi.fn();
const recordJobSuccess = vi.fn();

vi.mock("./http.js", () => ({ fetchWithPolicy: (...args: unknown[]) => fetchWithPolicy(...args) }));
vi.mock("./secret-store.js", () => ({
  readSecretKv: (...args: unknown[]) => readSecretKv(...args),
  writeSecretKv: (...args: unknown[]) => writeSecretKv(...args),
  deleteSecretKv: vi.fn(),
}));
vi.mock("./ssrf.js", () => ({
  resolveNotificationUrl: (...args: unknown[]) => resolveNotificationUrl(...args),
  validateNotificationUrl: (raw: string) => {
    try {
      return new URL(raw);
    } catch {
      return null;
    }
  },
}));
vi.mock("./prisma.js", () => ({ prisma: { metadata: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
vi.mock("./tmdb-client.js", () => ({ getTmdb: async () => ({ findByImdbId: (...a: unknown[]) => findByImdbId(...a) }) }));
vi.mock("./job-status.js", () => ({
  recordJobFailure: (...args: unknown[]) => recordJobFailure(...args),
  recordJobSuccess: (...args: unknown[]) => recordJobSuccess(...args),
}));

const { JellyseerrError, getJellyseerrConfig, pushWatchlistRequest, testJellyseerr } = await import("./jellyseerr.js");

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as Parameters<typeof pushWatchlistRequest>[2];

const CONFIG = {
  url: "http://jellyseerr.lan:5055",
  apiKey: "js_key",
  requestOnAdd: true,
  cancelOnRemove: false,
};

const storedConfig = (over: Partial<typeof CONFIG> = {}) => JSON.stringify({ ...CONFIG, ...over });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The (url, init) of the nth call through the policy wrapper. */
const callArgs = (index: number) => {
  const call = fetchWithPolicy.mock.calls[index];
  return { url: call?.[0] as string, init: (call?.[1] ?? {}) as RequestInit };
};

describe("jellyseerr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readSecretKv.mockResolvedValue(storedConfig());
    resolveNotificationUrl.mockImplementation(async (raw: string) => new URL(raw));
    findUnique.mockResolvedValue({ tmdbId: 603 });
    fetchWithPolicy.mockResolvedValue(json({}, 201));
    recordJobFailure.mockResolvedValue(undefined);
    recordJobSuccess.mockResolvedValue(undefined);
  });

  describe("getJellyseerrConfig", () => {
    it("returns null when nothing is stored", async () => {
      readSecretKv.mockResolvedValue(null);
      expect(await getJellyseerrConfig()).toBeNull();
    });

    it("reads a row written before the flags existed as request-adds, never-cancel", async () => {
      readSecretKv.mockResolvedValue(JSON.stringify({ url: CONFIG.url, apiKey: CONFIG.apiKey }));

      expect(await getJellyseerrConfig()).toEqual({
        url: CONFIG.url,
        apiKey: CONFIG.apiKey,
        requestOnAdd: true,
        cancelOnRemove: false,
      });
    });

    it("returns null for a stored blob that isn't a config", async () => {
      readSecretKv.mockResolvedValue("not json");
      expect(await getJellyseerrConfig()).toBeNull();
    });
  });

  describe("pushWatchlistRequest: adds", () => {
    it("requests a movie by its TMDB id", async () => {
      const outcome = await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger);

      expect(outcome).toBe("requested");
      const { url, init } = callArgs(0);
      expect(url).toBe("http://jellyseerr.lan:5055/api/v1/request");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ mediaType: "movie", mediaId: 603 });
      expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("js_key");
      // An allowed host must not be able to bounce the request elsewhere.
      expect(init.redirect).toBe("error");
      expect(recordJobSuccess).toHaveBeenCalledWith("jellyseerr-request");
    });

    it("requests every season of a series", async () => {
      await pushWatchlistRequest("add", { type: "series", imdbId: "tt0903747" }, logger);

      expect(JSON.parse(callArgs(0).init.body as string)).toEqual({
        mediaType: "tv",
        mediaId: 603,
        seasons: "all",
      });
    });

    it("keeps the path prefix of an instance behind a reverse proxy", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ url: "https://home.example/jellyseerr/" }));

      await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger);

      expect(callArgs(0).url).toBe("https://home.example/jellyseerr/api/v1/request");
    });

    it("falls back to TMDB when the metadata row has no TMDB id yet", async () => {
      findUnique.mockResolvedValue({ tmdbId: null });
      findByImdbId.mockResolvedValue({ tmdbId: 1399 });

      await pushWatchlistRequest("add", { type: "series", imdbId: "tt0944947" }, logger);

      expect(findByImdbId).toHaveBeenCalledWith("series", "tt0944947");
      expect(JSON.parse(callArgs(0).init.body as string)).toMatchObject({ mediaId: 1399 });
    });

    it("sends nothing when the title has no TMDB entry at all", async () => {
      findUnique.mockResolvedValue(null);
      findByImdbId.mockResolvedValue(null);

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt9999999" }, logger)).toBe("not-found");
      expect(fetchWithPolicy).not.toHaveBeenCalled();
      expect(recordJobFailure).not.toHaveBeenCalled();
    });

    it("treats an already-requested title as a success rather than a failure", async () => {
      fetchWithPolicy.mockResolvedValue(json({ message: "Request for this media already exists" }, 409));

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe(
        "already-requested"
      );
      expect(recordJobFailure).not.toHaveBeenCalled();
    });

    it("does nothing when Jellyseerr isn't configured", async () => {
      readSecretKv.mockResolvedValue(null);

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("skipped");
      expect(fetchWithPolicy).not.toHaveBeenCalled();
    });

    it("does nothing when requesting on add is turned off", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ requestOnAdd: false }));

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("skipped");
      expect(fetchWithPolicy).not.toHaveBeenCalled();
    });
  });

  describe("pushWatchlistRequest: failures", () => {
    it("records a rejected request against the job status instead of throwing", async () => {
      fetchWithPolicy.mockResolvedValue(json({ message: "nope" }, 500));

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("failed");
      expect(first(recordJobFailure.mock.calls, "a recorded job failure")[0]).toBe("jellyseerr-request");
    });

    it("records an unreachable server without throwing", async () => {
      fetchWithPolicy.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5055"));

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("failed");
      expect(recordJobFailure).toHaveBeenCalled();
    });

    it("refuses a stored URL that now resolves to a blocked address", async () => {
      resolveNotificationUrl.mockResolvedValue(null);

      expect(await pushWatchlistRequest("add", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("failed");
      expect(fetchWithPolicy).not.toHaveBeenCalled();
      expect(recordJobFailure).toHaveBeenCalled();
    });
  });

  describe("pushWatchlistRequest: removals", () => {
    it("leaves the request alone unless cancelling was opted into", async () => {
      expect(await pushWatchlistRequest("remove", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("skipped");
      expect(fetchWithPolicy).not.toHaveBeenCalled();
    });

    it("cancels a still-pending request for the same title", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ cancelOnRemove: true }));
      fetchWithPolicy
        .mockResolvedValueOnce(
          json({
            results: [
              { id: 7, status: 1, media: { tmdbId: 999, mediaType: "movie" } },
              { id: 8, status: 1, media: { tmdbId: 603, mediaType: "movie" } },
            ],
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      expect(await pushWatchlistRequest("remove", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("cancelled");
      expect(callArgs(1).url).toBe("http://jellyseerr.lan:5055/api/v1/request/8");
      expect(callArgs(1).init.method).toBe("DELETE");
    });

    it("never cancels a request that has already been approved", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ cancelOnRemove: true }));
      fetchWithPolicy.mockResolvedValue(
        json({ results: [{ id: 8, status: 2, media: { tmdbId: 603, mediaType: "movie" } }] })
      );

      expect(await pushWatchlistRequest("remove", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("not-found");
      expect(fetchWithPolicy).toHaveBeenCalledTimes(1);
    });

    it("does not mistake a series request for the movie of the same TMDB id", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ cancelOnRemove: true }));
      fetchWithPolicy.mockResolvedValue(
        json({ results: [{ id: 8, status: 1, media: { tmdbId: 603, mediaType: "tv" } }] })
      );

      expect(await pushWatchlistRequest("remove", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("not-found");
    });

    it("stops paging once a short page says there are no more pending requests", async () => {
      readSecretKv.mockResolvedValue(storedConfig({ cancelOnRemove: true }));
      fetchWithPolicy.mockResolvedValue(json({ results: [] }));

      expect(await pushWatchlistRequest("remove", { type: "movie", imdbId: "tt0133093" }, logger)).toBe("not-found");
      expect(fetchWithPolicy).toHaveBeenCalledTimes(1);
    });
  });

  describe("testJellyseerr", () => {
    it("reports the version and the instance's own name", async () => {
      fetchWithPolicy
        .mockResolvedValueOnce(json({ version: "2.5.2" }))
        .mockResolvedValueOnce(json({ applicationTitle: "Home Requests" }));

      expect(await testJellyseerr(CONFIG)).toEqual({ version: "2.5.2", applicationTitle: "Home Requests" });
      expect(callArgs(0).url).toBe("http://jellyseerr.lan:5055/api/v1/status");
      expect(callArgs(1).url).toBe("http://jellyseerr.lan:5055/api/v1/settings/main");
    });

    it("rejects a URL that answers 200 with something that isn't Jellyseerr", async () => {
      fetchWithPolicy.mockResolvedValue(json({ hello: "world" }));

      await expect(testJellyseerr(CONFIG)).rejects.toThrow(JellyseerrError);
      // The admin-only check is never reached, so a wrong URL can't be read as
      // a key problem.
      expect(fetchWithPolicy).toHaveBeenCalledTimes(1);
    });

    it("names a rejected API key, since that describes our own configuration", async () => {
      fetchWithPolicy.mockResolvedValueOnce(json({ version: "2.5.2" })).mockResolvedValueOnce(json({}, 403));

      await expect(testJellyseerr(CONFIG)).rejects.toMatchObject({
        outcome: "rejected",
        publicMessage: "Jellyseerr rejected that API key.",
      });
    });
  });
});
