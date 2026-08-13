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

type MarkWatchedTarget =
  | { type: "movie"; imdbId: string }
  | { type: "episode"; imdbId: string; season: number; episode: number };

// Mirrors the capability the addon mints into a "Mark Watched" subtitle URL:
// signed over the URL's profile segment and the one title it is for, so a token
// only ever authorises the single write it was issued for.
const capability = (
  target: MarkWatchedTarget,
  profileSegmentId: string | null,
  expiry = Date.now() + 60 * 60 * 1000
): string => {
  const scope = [
    "mark-watched",
    target.type,
    profileSegmentId ?? "-",
    target.imdbId,
    ...(target.type === "episode" ? [String(target.season), String(target.episode)] : []),
  ].join(":");
  return `${expiry}.${createHmac("sha256", API_TOKEN).update(`${scope}:${expiry}`).digest("hex")}`;
};

// The expiry the addon stamped is part of the token, so a URL it handed out can
// be re-derived from itself and compared — which pinning the clock would only
// obscure.
const capabilityMatches = (url: string, target: MarkWatchedTarget, profileSegmentId: string | null): boolean => {
  const token = new URL(url).searchParams.get("token") ?? "";
  const expiry = Number(token.split(".")[0]);
  return Number.isInteger(expiry) && expiry > Date.now() && token === capability(target, profileSegmentId, expiry);
};

process.env.CATALOGGY_API_TOKEN = API_TOKEN;
process.env.CATALOGGY_API_BASE = API_BASE;
process.env.ADDON_PUBLIC_BASE = ADDON_BASE;
process.env.LOG_LEVEL = "silent";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const WATCHLIST_ID = "list-1";
const CUSTOM_LIST_ID = "aaaaaaaa-1111-4111-8111-111111111111";

type AddonConfigStub = { enabledCatalogs: string[]; aiConfigured: boolean };

let calls: Call[] = [];
let watchStatus = 200;
let addonConfig: AddonConfigStub;
let addonConfigStatus = 200;
let lists: { id: string; name: string; kind: string }[];
let genresBody: unknown;

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
  if (pathname === "/lists") return jsonResponse({ lists });
  if (pathname === "/genres") return jsonResponse(genresBody);
  if (pathname === "/addon/config") {
    if (addonConfigStatus !== 200) return jsonResponse({ error: "boom" }, addonConfigStatus);
    return jsonResponse({
      config: { enabledCatalogs: addonConfig.enabledCatalogs },
      aiConfigured: addonConfig.aiConfigured,
    });
  }
  if (pathname === "/rpdb/config") return jsonResponse({ enabled: false, apiKey: null });
  if (pathname === "/settings/preferences") return jsonResponse({ spoilerProtection: false });
  if (pathname === "/stremio/play-signal") return jsonResponse({ status: "opened" }, 202);
  if (pathname.startsWith("/lists/") && pathname.endsWith("/items")) {
    return jsonResponse({ items: [{ imdbId: "tt0111161", type: "movie", title: "Shawshank", metadata: null }] });
  }
  if (
    pathname === "/trending" ||
    pathname === "/popular" ||
    pathname === "/anime" ||
    pathname === "/streaming" ||
    pathname === "/recommendations/personal" ||
    pathname === "/recommendations/ai"
  ) {
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
  addonConfig = { enabledCatalogs: [], aiConfigured: false };
  addonConfigStatus = 200;
  lists = [{ id: WATCHLIST_ID, name: "Watchlist", kind: "watchlist" }];
  genresBody = { genres: ["Drama"] };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  app = await buildApp();
});

afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

// The API and this service used to keep separate copies of the catalog list and
// separate ideas of what the shared config meant, so a catalog could be offered
// in Settings, honoured by one manifest and silently dropped by the other. Both
// now derive from the registry in @cataloggy/shared.
describe("manifest catalogs follow the profile's configuration", () => {
  type ManifestCatalog = { id: string; type: string; name: string };

  const manifestCatalogs = async (): Promise<ManifestCatalog[]> => {
    // Rebuilt per case: the manifest and the config it reads are both cached
    // for a minute, and the stubs change between cases.
    const fresh = await buildApp();
    try {
      const response = await fresh.inject({ method: "GET", url: "/manifest.json" });
      return (response.json() as { catalogs: ManifestCatalog[] }).catalogs;
    } finally {
      await fresh.close();
    }
  };

  const idsOf = async () => (await manifestCatalogs()).map((c) => c.id);

  it("advertises the AI Picks catalogs Settings offers, once an AI provider exists", async () => {
    addonConfig = { enabledCatalogs: ["cataloggy-ai-movie", "cataloggy-ai-series"], aiConfigured: true };

    const catalogs = await manifestCatalogs();

    expect(catalogs.map((c) => c.id)).toEqual(
      expect.arrayContaining(["cataloggy-ai-movie", "cataloggy-ai-series"])
    );
    // The row title comes from the shared registry, so Stremio and Settings
    // can't name the same catalog differently.
    expect(catalogs.find((c) => c.id === "cataloggy-ai-movie")?.name).toBe("AI Picks — Movies");
  });

  it("drops the AI catalogs when no AI provider is configured", async () => {
    addonConfig = { enabledCatalogs: ["cataloggy-ai-movie", "cataloggy-trending-movie"], aiConfigured: false };

    const ids = await idsOf();

    expect(ids).not.toContain("cataloggy-ai-movie");
    expect(ids).toContain("cataloggy-trending-movie");
  });

  it("advertises every catalog family the picker offers, not just trending and popular", async () => {
    addonConfig = {
      enabledCatalogs: ["cataloggy-anime-series", "cataloggy-netflix-movie", "cataloggy-recommended-movie"],
      aiConfigured: false,
    };

    expect(await idsOf()).toEqual(
      expect.arrayContaining(["cataloggy-anime-series", "cataloggy-netflix-movie", "cataloggy-recommended-movie"])
    );
  });

  it("leaves a custom list out until the profile enables it", async () => {
    lists = [
      { id: WATCHLIST_ID, name: "Watchlist", kind: "watchlist" },
      { id: CUSTOM_LIST_ID, name: "Weekend", kind: "custom" },
    ];
    addonConfig = { enabledCatalogs: [], aiConfigured: false };

    const ids = await idsOf();

    expect(ids).not.toContain(`cataloggy-${CUSTOM_LIST_ID}-movie`);
    // The watchlist has no checkbox in Settings, so it is never gated on one.
    expect(ids).toContain(`cataloggy-${WATCHLIST_ID}-movie`);
  });

  it("adds the custom list back once it is ticked", async () => {
    lists = [
      { id: WATCHLIST_ID, name: "Watchlist", kind: "watchlist" },
      { id: CUSTOM_LIST_ID, name: "Weekend", kind: "custom" },
    ];
    addonConfig = { enabledCatalogs: [`list:${CUSTOM_LIST_ID}`], aiConfigured: false };

    expect(await idsOf()).toEqual(
      expect.arrayContaining([`cataloggy-${CUSTOM_LIST_ID}-movie`, `cataloggy-${CUSTOM_LIST_ID}-series`])
    );
  });

  it("keeps a Stremio home screen populated when the config can't be read", async () => {
    // Nothing cached and no config to read: advertising a superset beats
    // emptying every row the user installed the addon for.
    addonConfigStatus = 500;

    const ids = await idsOf();

    expect(ids).toContain("cataloggy-trending-movie");
    expect(ids).not.toContain("cataloggy-ai-movie");
  });
});

describe("catalog routes serve only what the manifest advertised", () => {
  it("fetches AI catalog rows from the API's AI recommendations endpoint", async () => {
    addonConfig = { enabledCatalogs: ["cataloggy-ai-movie"], aiConfigured: true };
    const fresh = await buildApp();

    try {
      const response = await fresh.inject({ method: "GET", url: "/catalog/movie/cataloggy-ai-movie.json" });

      expect(response.json().metas).toHaveLength(1);
      expect(callsTo("/recommendations/ai")).toHaveLength(1);
    } finally {
      await fresh.close();
    }
  });

  it("returns nothing for a discovery catalog the profile disabled", async () => {
    addonConfig = { enabledCatalogs: ["cataloggy-popular-movie"], aiConfigured: false };
    const fresh = await buildApp();

    try {
      const response = await fresh.inject({ method: "GET", url: "/catalog/movie/cataloggy-trending-movie.json" });

      expect(response.json()).toEqual({ metas: [] });
      expect(callsTo("/trending")).toHaveLength(0);
    } finally {
      await fresh.close();
    }
  });

  it("returns nothing for a custom list the profile unticked", async () => {
    lists = [{ id: CUSTOM_LIST_ID, name: "Weekend", kind: "custom" }];
    addonConfig = { enabledCatalogs: [], aiConfigured: false };
    const fresh = await buildApp();

    try {
      const response = await fresh.inject({
        method: "GET",
        url: `/catalog/movie/cataloggy-${CUSTOM_LIST_ID}-movie.json`,
      });

      expect(response.json()).toEqual({ metas: [] });
      expect(callsTo(`/lists/${CUSTOM_LIST_ID}/items`)).toHaveLength(0);
    } finally {
      await fresh.close();
    }
  });

  it("still serves an enabled custom list", async () => {
    lists = [{ id: CUSTOM_LIST_ID, name: "Weekend", kind: "custom" }];
    addonConfig = { enabledCatalogs: [`list:${CUSTOM_LIST_ID}`], aiConfigured: false };
    const fresh = await buildApp();

    try {
      const response = await fresh.inject({
        method: "GET",
        url: `/catalog/movie/cataloggy-${CUSTOM_LIST_ID}-movie.json`,
      });

      expect(response.json().metas).toEqual([
        expect.objectContaining({ id: "tt0111161", name: "Shawshank" }),
      ]);
    } finally {
      await fresh.close();
    }
  });
});

describe("API response contracts", () => {
  it("treats a response of the wrong shape as a failure rather than serving undefined", async () => {
    // `response.json() as T` used to make this a manifest full of `undefined`
    // genre options; now the parser rejects it and the cached-value fallback
    // that every other API failure already uses takes over.
    genresBody = { genres: "Drama" };
    const fresh = await buildApp();

    try {
      const response = await fresh.inject({ method: "GET", url: "/manifest.json" });

      expect(response.statusCode).toBe(200);
      const genreExtra = (response.json() as {
        catalogs: { extra: { name: string; options?: string[] }[] }[];
      }).catalogs[0]?.extra.find((e) => e.name === "genre");
      expect(genreExtra?.options).toEqual(["A-Z", "Z-A"]);
    } finally {
      await fresh.close();
    }
  });
});

describe("profile scoping", () => {
  it("sends the profile from the addon URL as x-profile-id when marking a movie watched", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID)}`,
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
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/episode/tt0903747/2/5.srt?token=${capability(
        { type: "episode", imdbId: "tt0903747", season: 2, episode: 5 },
        OTHER_PROFILE_ID
      )}`,
    });

    expect(response.body).toContain("Marked as watched");

    const [watchCall] = callsTo("/watch");
    expect(watchCall.headers["x-profile-id"]).toBe(OTHER_PROFILE_ID);
    expect(watchCall.body).toMatchObject({ type: "episode", seriesImdbId: "tt0903747", season: 2, episode: 5 });
  });

  it("falls back to the oldest profile for an addon URL installed without a profile", async () => {
    await app.inject({
      method: "GET",
      url: `/mark-watched/movie/tt0111161.srt?token=${capability({ type: "movie", imdbId: "tt0111161" }, null)}`,
    });

    const [watchCall] = callsTo("/watch");
    expect(watchCall.headers["x-profile-id"]).toBe(DEFAULT_PROFILE_ID);
  });

  it("offers the app icon as the addon's logo once the web UI has a public address", async () => {
    const before = await app.inject({ method: "GET", url: "/manifest.json" });
    // Stremio fetches the logo itself, so it stays absent rather than relative.
    expect(JSON.parse(before.body).logo).toBeUndefined();

    process.env.CATALOGGY_WEB_PUBLIC = "https://cataloggy.example/";
    try {
      const configured = await buildApp();
      const response = await configured.inject({ method: "GET", url: "/manifest.json" });
      expect(JSON.parse(response.body).logo).toBe("https://cataloggy.example/icons/icon-192.png");
    } finally {
      delete process.env.CATALOGGY_WEB_PUBLIC;
    }
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
    expect(subtitles[0].url).toContain(
      `${ADDON_BASE}/p/${OTHER_PROFILE_ID}/mark-watched/episode/tt0903747/2/5.srt?token=`
    );
    expect(
      capabilityMatches(subtitles[0].url, { type: "episode", imdbId: "tt0903747", season: 2, episode: 5 }, OTHER_PROFILE_ID)
    ).toBe(true);
  });

  it("pins the resolved default profile into the mark-watched URL for an unprefixed install", async () => {
    const response = await app.inject({ method: "GET", url: "/subtitles/movie/tt0111161.json" });

    const { subtitles } = response.json() as { subtitles: { url: string }[] };
    expect(subtitles[0].url).toContain(
      `${ADDON_BASE}/p/${DEFAULT_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=`
    );
    expect(capabilityMatches(subtitles[0].url, { type: "movie", imdbId: "tt0111161" }, DEFAULT_PROFILE_ID)).toBe(true);
  });

  it("refuses a malformed profile id rather than writing to the default profile", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/p/not-a-uuid/mark-watched/movie/tt0111161.srt?token=${capability({ type: "movie", imdbId: "tt0111161" }, "not-a-uuid")}`,
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
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID)}`,
    });

    expect(callsTo("/watch")).toHaveLength(1);
    expect(response.body).not.toContain("Marked as watched");
    expect(response.body).toContain("could not record this");
  });

  it("says an episode write failed instead of reporting success", async () => {
    watchStatus = 400;

    const response = await app.inject({
      method: "GET",
      url: `/mark-watched/episode/tt0903747/2/5.srt?token=${capability(
        { type: "episode", imdbId: "tt0903747", season: 2, episode: 5 },
        null
      )}`,
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
    // No capability is ever minted for a bare series, so this route can only be
    // reached by hand — it answers with the reason rather than a bare rejection.
    const response = await app.inject({
      method: "GET",
      url: `/mark-watched/series/tt0903747.srt?token=${capability({ type: "movie", imdbId: "tt0903747" }, null)}`,
    });

    expect(response.body).toContain("select a specific episode first");
    expect(callsTo("/watch")).toHaveLength(0);
  });
});

// An unauthenticated GET of /subtitles used to return the addon's one mutation
// token — the credential behind every write it accepts — so anyone who could
// reach the service could forge watch history and scrobbles for any profile.
// What that route hands out now only authorises the single write it names.
describe("mark-watched capabilities", () => {
  const markWatched = (url: string) => app.inject({ method: "GET", url });

  it("keeps the mutation token out of the unauthenticated subtitles response", async () => {
    const response = await markWatched("/subtitles/movie/tt0111161.json");

    expect(response.body).not.toContain(MUTATION_TOKEN);
  });

  it("refuses the mutation token itself as a mark-watched credential", async () => {
    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${MUTATION_TOKEN}`);

    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("refuses a capability minted for a different title", async () => {
    const stolen = capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID);

    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0068646.srt?token=${stolen}`);

    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("refuses a capability minted for a different episode of the same series", async () => {
    const stolen = capability({ type: "episode", imdbId: "tt0903747", season: 2, episode: 5 }, OTHER_PROFILE_ID);

    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/episode/tt0903747/2/6.srt?token=${stolen}`);

    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("refuses a capability minted for a different profile", async () => {
    const stolen = capability({ type: "movie", imdbId: "tt0111161" }, DEFAULT_PROFILE_ID);

    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${stolen}`);

    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("refuses an expired capability, and says that rather than blaming the install", async () => {
    const expired = capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID, Date.now() - 1000);

    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${expired}`);

    expect(response.body).toContain("expired");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  it("refuses a capability whose expiry was extended after signing", async () => {
    const issued = capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID, Date.now() - 1000);
    const extended = `${Date.now() + 60_000}.${issued.split(".")[1]}`;

    const response = await markWatched(`/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${extended}`);

    expect(response.body).toContain("rejected this request");
    expect(callsTo("/watch")).toHaveLength(0);
  });

  // Stremio can only follow a link, so a capability has nowhere but the query
  // string to travel — and Fastify's default request serializer would write the
  // whole URL to a log that docker-compose keeps 30 MB of.
  it("does not write the capability in a mark-watched URL to its own log", () => {
    // Read back off the running instance's logger rather than from a serializer
    // built here, so this fails if app.ts ever stops installing it.
    const serializersSymbol = Object.getOwnPropertySymbols(app.log).find(
      (symbol) => symbol.description === "pino.serializers"
    );
    expect(serializersSymbol).toBeDefined();

    const serializers = (app.log as unknown as Record<symbol, Record<string, (req: unknown) => unknown>>)[
      serializersSymbol as symbol
    ];
    const token = capability({ type: "movie", imdbId: "tt0111161" }, OTHER_PROFILE_ID);
    const logged = serializers.req({
      method: "GET",
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=${token}`,
    });

    expect(JSON.stringify(logged)).not.toContain(token);
    expect(logged).toMatchObject({
      url: `/p/${OTHER_PROFILE_ID}/mark-watched/movie/tt0111161.srt?token=REDACTED`,
    });
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

    it("forwards the player's own user-agent, not this service's", async () => {
      // Without this the API would only ever see the addon's fetch agent, which
      // says nothing about which app is watching — the one thing the field is for.
      await app.inject({
        method: "GET",
        url: "/stream/movie/tt0111161.json",
        headers: { "user-agent": "Vidi/2.1 (Apple TV)" },
      });

      const [signal] = await waitForSignals(1);
      expect((signal.body as { client?: string }).client).toBe("Vidi/2.1 (Apple TV)");
    });

    it("sends no client at all rather than an empty one when the request carries no user-agent", async () => {
      await app.inject({ method: "GET", url: "/stream/movie/tt0111161.json", headers: { "user-agent": "" } });

      const [signal] = await waitForSignals(1);
      expect(signal.body).not.toHaveProperty("client");
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
