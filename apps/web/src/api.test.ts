import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, invalidatedCachePrefixes, runtimeConfig } from "./api";
import { readCache, resetDataCacheForTests, writeCache } from "./utils/dataCache";

type FetchMock = ReturnType<typeof vi.fn>;

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

/** A 401 from the bearer-token middleware itself (RFC 6750). */
const unauthorized = (body: unknown = { error: "Unauthorized" }) =>
  new Response(JSON.stringify(body), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="cataloggy"' },
  });

/** A route-level 401 — no WWW-Authenticate header. */
const routeError = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  runtimeConfig.setToken("stored-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const lastRequestInit = () => fetchMock.mock.calls[0][1] as RequestInit;
const lastHeaders = () => lastRequestInit().headers as Record<string, string>;

describe("request auth headers", () => {
  it("sends the stored bearer token", async () => {
    fetchMock.mockResolvedValue(json({ lists: [] }));

    await api.getLists();

    expect(fetchMock.mock.calls[0][0]).toBe(`${runtimeConfig.getApiBase()}/lists`);
    expect(lastHeaders().Authorization).toBe("Bearer stored-token");
  });

  it("sends the profile id and profile token when a profile is selected", async () => {
    runtimeConfig.setProfileId("profile-1");
    runtimeConfig.setProfileToken("signed-capability");
    fetchMock.mockResolvedValue(json({ lists: [] }));

    await api.getLists();

    expect(lastHeaders()["x-profile-id"]).toBe("profile-1");
    expect(lastHeaders()["x-profile-token"]).toBe("signed-capability");
  });

  it("omits the profile headers entirely when no profile is selected", async () => {
    fetchMock.mockResolvedValue(json({ lists: [] }));

    await api.getLists();

    expect(lastHeaders()).not.toHaveProperty("x-profile-id");
    expect(lastHeaders()).not.toHaveProperty("x-profile-token");
  });

  it("sets a JSON content type only for requests with a body", async () => {
    fetchMock.mockResolvedValue(json({ lists: [] }));
    await api.getLists();
    expect(lastHeaders()).not.toHaveProperty("Content-Type");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json({ list: { id: "1" } }));
    await api.createList("Watch later");
    expect(lastHeaders()["Content-Type"]).toBe("application/json");
  });
});

describe("request 401 handling", () => {
  it("clears the stored token and announces it when the token itself is rejected", async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener("cataloggy:unauthorized", onUnauthorized);
    fetchMock.mockResolvedValue(unauthorized());

    await expect(api.getLists()).rejects.toThrow(ApiError);

    expect(runtimeConfig.getToken()).toBe("");
    expect(onUnauthorized).toHaveBeenCalledOnce();
    window.removeEventListener("cataloggy:unauthorized", onUnauthorized);
  });

  it("keeps the token on a route-level 401 that carries no WWW-Authenticate header", async () => {
    const onUnauthorized = vi.fn();
    window.addEventListener("cataloggy:unauthorized", onUnauthorized);
    fetchMock.mockResolvedValue(routeError(401, { error: "Incorrect PIN." }));

    await expect(api.getLists()).rejects.toThrow("Incorrect PIN.");

    expect(runtimeConfig.getToken()).toBe("stored-token");
    expect(onUnauthorized).not.toHaveBeenCalled();
    window.removeEventListener("cataloggy:unauthorized", onUnauthorized);
  });

  it("drops the profile selection and its token when profile verification is required", async () => {
    const onLocked = vi.fn();
    window.addEventListener("cataloggy:profile-locked", onLocked);
    runtimeConfig.setProfileId("profile-1");
    runtimeConfig.setProfileToken("signed-capability");
    fetchMock.mockResolvedValue(
      routeError(401, { error: "Profile verification required", code: "profile_verification_required" })
    );

    await expect(api.getLists()).rejects.toThrow(ApiError);

    expect(runtimeConfig.getProfileId()).toBe("");
    expect(runtimeConfig.getProfileToken()).toBe("");
    expect(onLocked).toHaveBeenCalledOnce();
    // The bearer token is unrelated to a locked profile and must survive.
    expect(runtimeConfig.getToken()).toBe("stored-token");
    window.removeEventListener("cataloggy:profile-locked", onLocked);
  });

  it("does not treat the profile_verification_required code on a non-401 as a lock", async () => {
    const onLocked = vi.fn();
    window.addEventListener("cataloggy:profile-locked", onLocked);
    runtimeConfig.setProfileId("profile-1");
    fetchMock.mockResolvedValue(routeError(403, { error: "Forbidden", code: "profile_verification_required" }));

    await expect(api.getLists()).rejects.toThrow(ApiError);

    expect(runtimeConfig.getProfileId()).toBe("profile-1");
    expect(onLocked).not.toHaveBeenCalled();
    window.removeEventListener("cataloggy:profile-locked", onLocked);
  });
});

describe("request error reporting", () => {
  it("surfaces the API's error message and status", async () => {
    fetchMock.mockResolvedValue(routeError(404, { error: "List not found" }));

    const err = await api.getLists().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("List not found");
    expect((err as ApiError).status).toBe(404);
  });

  it("falls back to the raw body when the error is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    await expect(api.getLists()).rejects.toThrow("<html>502 Bad Gateway</html>");
  });

  it("falls back to the status when the body is empty", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));

    await expect(api.getLists()).rejects.toThrow("Request failed: 500");
  });

  it("explains that the URL points at the wrong server when HTML comes back with a 200", async () => {
    fetchMock.mockResolvedValue(
      new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } })
    );

    await expect(api.getLists()).rejects.toThrow(/points to the Cataloggy API server/);
  });

  it("reports an unreachable API rather than a bare network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api.getLists()).rejects.toThrow(/cannot reach/);
  });

  it("says the device is offline instead of blaming the server when there is no network", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    try {
      await expect(api.getLists()).rejects.toThrow(/You're offline/);
      await expect(api.getLists()).rejects.not.toThrow(/API server is running/);
    } finally {
      onLine.mockRestore();
    }
  });

  it("rethrows the caller's AbortError untouched when a request is cancelled on purpose", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(abortError);
    });

    await expect(api.search("movie", "dune", controller.signal)).rejects.toBe(abortError);
  });
});

describe("request response decoding", () => {
  it("resolves to undefined for a 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(api.deleteList("list-1")).resolves.toBeUndefined();
  });

  it("accepts vendor +json content types", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ lists: [] }), {
        status: 200,
        headers: { "content-type": "application/vnd.cataloggy+json" },
      })
    );

    await expect(api.getLists()).resolves.toEqual({ lists: [] });
  });
});

describe("verifyProfile", () => {
  it("stores the signed capability returned by the server", async () => {
    fetchMock.mockResolvedValue(json({ id: "profile-1", name: "Ben", profileToken: "signed-capability" }));

    await api.verifyProfile("profile-1", "1234");

    expect(runtimeConfig.getProfileToken()).toBe("signed-capability");
    expect(lastRequestInit().body).toBe(JSON.stringify({ pin: "1234" }));
  });

  it("clears any stale capability when the profile has no PIN", async () => {
    runtimeConfig.setProfileToken("stale-capability");
    fetchMock.mockResolvedValue(json({ id: "profile-1", name: "Ben" }));

    await api.verifyProfile("profile-1");

    expect(runtimeConfig.getProfileToken()).toBe("");
    expect(lastRequestInit().body).toBe("{}");
  });
});

describe("runtimeConfig", () => {
  it("prefers a saved API base override over the build-time default", () => {
    expect(runtimeConfig.getApiBase()).toBe(runtimeConfig.apiBaseDefault);

    runtimeConfig.setApiBaseOverride("  https://cataloggy.example  ");

    expect(runtimeConfig.getApiBaseOverride()).toBe("https://cataloggy.example");
    expect(runtimeConfig.getApiBase()).toBe("https://cataloggy.example");
  });

  it("removes the override rather than storing a blank one", () => {
    runtimeConfig.setApiBaseOverride("https://cataloggy.example");
    runtimeConfig.setApiBaseOverride("   ");

    expect(window.localStorage.getItem(runtimeConfig.apiBaseOverrideKey)).toBeNull();
    expect(runtimeConfig.getApiBase()).toBe(runtimeConfig.apiBaseDefault);
  });

  it("removes the token rather than storing a blank one", () => {
    runtimeConfig.setToken("  ");

    expect(window.localStorage.getItem(runtimeConfig.tokenKey)).toBeNull();
    expect(runtimeConfig.getToken()).toBe("");
  });

  it("clears the profile token alongside the profile id", () => {
    runtimeConfig.setProfileId("profile-1");
    runtimeConfig.setProfileToken("signed-capability");

    runtimeConfig.clearProfileId();

    expect(runtimeConfig.getProfileId()).toBe("");
    expect(runtimeConfig.getProfileToken()).toBe("");
  });
});

describe("API response cache on sign-out", () => {
  let cachesDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cachesDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: cachesDelete });
  });

  it("drops the cache when the token changes", async () => {
    runtimeConfig.setToken("a-new-token");
    await Promise.resolve();

    expect(cachesDelete).toHaveBeenCalledWith("api-runtime-v1");
  });

  it("drops the cache when the token is cleared on sign-out", async () => {
    runtimeConfig.setToken("");
    await Promise.resolve();

    expect(cachesDelete).toHaveBeenCalledWith("api-runtime-v1");
  });

  it("leaves the cache alone when the same token is written back", async () => {
    runtimeConfig.setToken("stored-token");
    await Promise.resolve();

    expect(cachesDelete).not.toHaveBeenCalled();
  });

  it("drops the cache when the profile is cleared", async () => {
    runtimeConfig.clearProfileId();
    await Promise.resolve();

    expect(cachesDelete).toHaveBeenCalledWith("api-runtime-v1");
  });

  it("purges on a 401 from the bearer-token middleware", async () => {
    fetchMock.mockResolvedValue(unauthorized());

    await expect(api.getLists()).rejects.toThrow();

    expect(runtimeConfig.getToken()).toBe("");
    expect(cachesDelete).toHaveBeenCalledWith("api-runtime-v1");
  });

  it("still signs out when Cache Storage rejects", async () => {
    cachesDelete.mockRejectedValue(new Error("unavailable"));

    runtimeConfig.setToken("");
    await Promise.resolve();

    expect(runtimeConfig.getToken()).toBe("");
  });
});

/*
 * Which cached pages a write is allowed to take down with it.
 *
 * Every mutation used to call `invalidateAll()`, so rating one episode dropped
 * the lists page's rows, the games library's and the calendar's alongside the
 * stats it actually moved — and the next visit to any of them was a full
 * refetch behind a skeleton, which is the wait the cache exists to remove.
 */
describe("memory cache invalidation after a mutation", () => {
  it("keeps a write inside the domain it can reach", () => {
    expect(invalidatedCachePrefixes("/games/abc")).toEqual(["games:"]);
    expect(invalidatedCachePrefixes("/games/steam/sync")).toEqual(["games:"]);
    expect(invalidatedCachePrefixes("/lists/watchlist/items")).toEqual(["lists:"]);
    expect(invalidatedCachePrefixes("/ratings")).toEqual(["stats:", "dash:"]);
  });

  it("treats every way of recording a watch as one domain", () => {
    const watchDomain = ["dash:", "history:", "stats:", "calendar:"];
    for (const path of [
      "/watch",
      "/watch/evt-1",
      "/checkin?log=true",
      "/series/tt1/watch-next",
      "/series/tt1/season/2/episode/3/watch",
      "/series/tt1/season/2/watch-all",
      "/show/tt1/drop",
    ]) {
      expect(invalidatedCachePrefixes(path)).toEqual(watchDomain);
    }
  });

  it("drops everything for anything it doesn't recognise", () => {
    // A Trakt import writes thousands of watch rows and a metadata refresh
    // changes every poster, so these really do mean everything — and so does a
    // route added later that nobody remembered to list here.
    expect(invalidatedCachePrefixes("/trakt/import")).toBeNull();
    expect(invalidatedCachePrefixes("/metadata/refresh-all")).toBeNull();
    expect(invalidatedCachePrefixes("/settings/preferences")).toBeNull();
    expect(invalidatedCachePrefixes("/some/future/endpoint")).toBeNull();
  });

  it("never mistakes /watchlist for the watch domain", () => {
    expect(invalidatedCachePrefixes("/watchlist")).toBeNull();
  });

  it("leaves the games library alone when an episode is marked watched", async () => {
    resetDataCacheForTests();
    writeCache("games:recent", ["Outer Wilds"]);
    writeCache("lists:all", [{ id: "watchlist" }]);
    writeCache("dash:progress", [{ imdbId: "tt1" }]);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await api.markEpisodeWatched("tt1", 2, 3);

    expect(readCache("dash:progress")).toBeUndefined();
    expect(readCache("games:recent")).toEqual(["Outer Wilds"]);
    expect(readCache("lists:all")).toEqual([{ id: "watchlist" }]);
  });

  it("drops every page when the mutation is one with no mapping", async () => {
    resetDataCacheForTests();
    writeCache("games:recent", ["Outer Wilds"]);
    writeCache("dash:progress", [{ imdbId: "tt1" }]);
    fetchMock.mockResolvedValue(json({ imported: {} }));

    await api.traktImport();

    expect(readCache("games:recent")).toBeUndefined();
    expect(readCache("dash:progress")).toBeUndefined();
  });

  it("invalidates even when the write failed", async () => {
    // A half-failed write can still have landed server-side.
    resetDataCacheForTests();
    writeCache("dash:progress", [{ imdbId: "tt1" }]);
    fetchMock.mockResolvedValue(routeError(500, { error: "nope" }));

    await expect(api.markEpisodeWatched("tt1", 2, 3)).rejects.toThrow();

    expect(readCache("dash:progress")).toBeUndefined();
  });
});
