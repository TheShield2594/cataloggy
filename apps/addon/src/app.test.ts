import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const API_TOKEN = "test-api-token";
const API_BASE = "http://api.test";
const ADDON_BASE = "http://addon.test";

// The oldest profile — what the API's getDefaultProfileId picks, and therefore
// what an addon URL with no /p/<uuid> prefix must resolve to.
const DEFAULT_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const MUTATION_TOKEN = createHmac("sha256", API_TOKEN).update("cataloggy-addon-mutation").digest("hex");

process.env.CATALOGGY_API_TOKEN = API_TOKEN;
process.env.CATALOGGY_API_BASE = API_BASE;
process.env.ADDON_PUBLIC_BASE = ADDON_BASE;
process.env.LOG_LEVEL = "silent";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

let calls: Call[] = [];
let watchStatus = 200;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({
    url,
    method: init?.method ?? "GET",
    headers,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  });

  const { pathname, searchParams } = new URL(url);

  if (pathname === "/profiles") {
    return jsonResponse({ profiles: [{ id: DEFAULT_PROFILE_ID }, { id: OTHER_PROFILE_ID }] });
  }
  if (pathname === "/watch") {
    return watchStatus === 200 ? jsonResponse({ ok: true }) : jsonResponse({ error: "nope" }, watchStatus);
  }
  if (pathname.startsWith("/scrobble/")) return jsonResponse({ ok: true, action: pathname.slice(10) });
  if (pathname === "/lists") return jsonResponse({ lists: [{ id: "list-1", name: "Watchlist", kind: "watchlist" }] });
  if (pathname === "/genres") return jsonResponse({ genres: ["Drama"] });
  if (pathname === "/addon/config") return jsonResponse({ config: { enabledCatalogs: [] } });
  if (pathname === "/rpdb/config") return jsonResponse({ enabled: false, apiKey: null });
  if (pathname === "/settings/preferences") return jsonResponse({ spoilerProtection: false });
  if (pathname === "/stremio/play-signal") return jsonResponse({ status: "opened" }, 202);
  if (pathname === "/trending" || pathname === "/popular") {
    return jsonResponse({ metas: [{ id: `tt-${searchParams.get("type")}`, type: searchParams.get("type"), name: "X" }] });
  }

  return jsonResponse({ error: `unstubbed ${pathname}` }, 404);
});

const callsTo = (pathname: string) => calls.filter((call) => new URL(call.url).pathname === pathname);

let app: FastifyInstance;

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const module = await import("./app.js");
  await module.app.ready();
  return module.app;
};

beforeEach(async () => {
  calls = [];
  watchStatus = 200;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

describe("profile scoping", () => {
  it("sends the profile from the addon URL as x-profile-id when marking a movie watched", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Marked as watched");

    const [watchCall] = callsTo("/watch");
    expect(watchCall).toBeDefined();
    expect(watchCall.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
    expect(watchCall.body).toEqual({ type: "movie", imdbId: "tt0111161" });
  });

  it("sends the profile when marking an episode watched", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/episode/tt0903747/2/5.srt?token=${MUTATION_TOKEN}`,
    });

    expect(response.body).toContain("Marked as watched");

    const [watchCall] = callsTo("/watch");
    expect(watchCall.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
    expect(watchCall.body).toMatchObject({ type: "episode", seriesImdbId: "tt0903747", season: 2, episode: 5 });
  });

  it("falls back to the oldest profile for an addon URL installed without a profile", async () => {
    await app.inject({ method: "GET", url: `/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}` });

    const [watchCall] = callsTo("/watch");
    expect(watchCall.headers["x-profile-id"]).toBe(DEFAULT_PROFILE_ID);
  });

  it("scopes catalog reads to the profile in the addon URL", async () => {
    await app.inject({ method: "GET", url: `/p/${OTHER_PROFILE_ID}/manifest.json` });

    const [listsCall] = callsTo("/lists");
    expect(listsCall.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
  });

  it("forwards the profile on scrobble events", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/p/${OTHER_PROFILE_ID}/scrobble/start`,
      headers: { authorization: `Bearer ${MUTATION_TOKEN}` },
      payload: { type: "movie", imdbId: "tt0111161", progress: 12 },
    });

    expect(response.statusCode).toBe(200);
    const [scrobbleCall] = callsTo("/scrobble/start");
    expect(scrobbleCall.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
  });

  it("carries the profile through to the mark-watched URL it hands Stremio", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/subtitles/series/tt0903747:2:5.json`,
    });

    const { subtitles } = response.json() as { subtitles: { url: string }[] };
    expect(subtitles[0].url).toBe(
      `${ADDON_BASE}/p/${OTHER_PROFILE_ID}/mark-watched/episode/tt0903747/2/5.srt?token=${MUTATION_TOKEN}`
    );
  });

  it("pins the resolved default profile into the mark-watched URL for an unprefixed install", async () => {
    const response = await app.inject({ method: "GET", url: "/subtitles/movie/tt0111161.json" });

    const { subtitles } = response.json() as { subtitles: { url: string }[] };
    expect(subtitles[0].url).toBe(
      `${ADDON_BASE}/p/${DEFAULT_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}`
    );
  });

  it("refuses a malformed profile id rather than writing to the default profile", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/not-a-uuid/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}`,
    });

    expect(response.body).not.toContain("Marked as watched");
    expect(response.body).toContain("profile not recognised");
    expect(callsTo("/watch")).toHaveLength(0);
  });
});

describe("mark-watched feedback", () => {
  it("says the write failed instead of reporting success", async () => {
    watchStatus = 400;

    const response = await app.inject({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}`,
    });

    expect(callsTo("/watch")).toHaveLength(1);
    expect(response.body).not.toContain("Marked as watched");
    expect(response.body).toContain("could not record this");
  });

  it("says an episode write failed instead of reporting success", async () => {
    watchStatus = 400;

    const response = await app.inject({
      method: "GET",
      url: `/mark-watched/episode/tt0903747/2/5.srt?token=${MUTATION_TOKEN}`,
    });

    expect(response.body).not.toContain("Marked as watched");
    expect(response.body).toContain("could not record this");
  });

  it("says the request was rejected instead of reporting success when the token is missing", async () => {
    const response = await app.inject({ method: "GET", url: "/mark-watched/movie/tt0111161.srt" });

    expect(response.body).not.toContain("Marked as watched");
    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("still refuses to mark a whole series watched", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/mark-watched/series/tt0903747.srt?token=${MUTATION_TOKEN}`,
    });

    expect(response.body).toContain("select a specific episode first");
    expect(callsTo("/watch")).toHaveLength(0);
  });
});

describe("play detection", () => {
  // The signal is fire-and-forget, so the response returns before the POST has
  // necessarily landed. Yield until it shows up rather than asserting blind.
  const waitForSignals = async (expected: number): Promise<Call[]> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const signals = callsTo("/stremio/play-signal");
      if (signals.length >= expected) return signals;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return callsTo("/stremio/play-signal");
  };

  describe("when enabled", () => {
    beforeEach(async () => {
      process.env.STREMIO_PLAY_DETECTION = "true";
      await app.close();
      calls = [];
      app = await buildApp();
    });

    afterEach(() => {
      delete process.env.STREMIO_PLAY_DETECTION;
    });

    it("declares the stream resource so clients ask about titles they open", async () => {
      const response = await app.inject({ method: "GET", url: "/manifest.json" });
      expect(JSON.parse(response.body).resources).toContain("stream");
    });

    it("answers a stream request with an empty list and forwards the signal", async () => {
      const response = await app.inject({ method: "GET", url: "/stream/movie/tt0111161.json" });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ streams: [] });

      const [signal] = await waitForSignals(1);
      expect(signal.body).toMatchObject({ type: "movie", imdbId: "tt0111161", resource: "stream" });
    });

    it("forwards an episode signal with its season and episode", async () => {
      await app.inject({ method: "GET", url: "/stream/series/tt0903747:2:7.json" });

      const [signal] = await waitForSignals(1);
      expect(signal.body).toMatchObject({
        type: "episode",
        seriesImdbId: "tt0903747",
        season: 2,
        episode: 7,
        resource: "stream",
      });
    });

    it("forwards the profile pinned in the addon URL", async () => {
      await app.inject({ method: "GET", url: `/p/${OTHER_PROFILE_ID}/stream/movie/tt0111161.json` });

      const [signal] = await waitForSignals(1);
      expect(signal.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
    });

    it("forwards a signal from the subtitles request too", async () => {
      await app.inject({ method: "GET", url: "/subtitles/series/tt0903747:2:7.json" });

      const [signal] = await waitForSignals(1);
      expect(signal.body).toMatchObject({ resource: "subtitles", season: 2, episode: 7 });
    });

    it("sends nothing for a bare series id, which names no episode to record", async () => {
      await app.inject({ method: "GET", url: "/stream/series/tt0903747.json" });

      expect(await waitForSignals(1)).toHaveLength(0);
    });

    it("sends nothing for content that is not IMDb-keyed", async () => {
      await app.inject({ method: "GET", url: "/stream/movie/kitsu:12345.json" });

      expect(await waitForSignals(1)).toHaveLength(0);
    });

    it("still answers the stream request when forwarding the signal fails", async () => {
      fetchMock.mockImplementationOnce(async () => {
        throw new Error("api down");
      });

      const response = await app.inject({ method: "GET", url: "/stream/movie/tt0111161.json" });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ streams: [] });
    });
  });

  describe("when disabled", () => {
    it("still answers stream requests, but forwards nothing", async () => {
      const response = await app.inject({ method: "GET", url: "/stream/movie/tt0111161.json" });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ streams: [] });
      expect(callsTo("/stremio/play-signal")).toHaveLength(0);
    });

    it("forwards nothing from a subtitles request either", async () => {
      await app.inject({ method: "GET", url: "/subtitles/series/tt0903747:2:7.json" });

      expect(callsTo("/stremio/play-signal")).toHaveLength(0);
    });
  });
});
