import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";

// The AI provider is the one outbound target a user configures freely: any URL,
// any headers. That is what makes it the SSRF surface, and the request builder
// is where the hardening lives — the pre-flight re-resolution, `redirect: "error"`
// so an allowed host cannot bounce the Authorization header somewhere internal,
// and an error that does not echo the upstream body back to the caller. The
// route tests exercise the endpoints; none of them reach this.

const prismaMock = {
  watchEvent: { findMany: vi.fn() },
  metadata: { findMany: vi.fn() },
  rating: { findMany: vi.fn() },
  kV: { findUnique: vi.fn(), upsert: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const readSecretKv = vi.fn();
vi.mock("./secret-store.js", () => ({ readSecretKv: (key: string) => readSecretKv(key) }));

const resolveAiProviderUrl = vi.fn();
vi.mock("./ssrf.js", () => ({ resolveAiProviderUrl: (url: string) => resolveAiProviderUrl(url) }));

const search = vi.fn();
vi.mock("./tmdb-client.js", () => ({ getTmdb: async () => ({ search }) }));

vi.mock("./rpdb.js", () => ({
  getRpdbApiKey: async () => null,
  withRpdbPoster: (_id: string, poster: string | null) => poster,
}));

const upsertMetadata = vi.fn();
vi.mock("./metadata.js", () => ({ upsertMetadata: (...args: unknown[]) => upsertMetadata(...args) }));

const { AI_CONFIG_KEY, getAiConfig, getAiRecommendations, isAiConfigured, redactAiConfig, shouldRefreshAiRecs } =
  await import("./ai.js");
const { trendingCacheDeletePrefix, watchedImdbIdsCache } = await import("./cache.js");

const CONFIG = {
  url: "https://llm.example/v1/chat/completions",
  headers: { Authorization: "Bearer sk-secret-value" },
  payload: { model: "gpt-4o-mini", max_tokens: 4096 },
};

const aiResponse = (content: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content } }] }),
});

const ONE_REC = JSON.stringify([{ title: "Heat", year: 1995, type: "movie", reason: "crime, patiently" }]);

const fetchMock = vi.fn();
// Kept separately from the cast so the assertions below can read the calls;
// `as never` at the call site would hide them from the typechecker too.
const loggerMocks = { error: vi.fn(), debug: vi.fn() };
const logger = loggerMocks as unknown as FastifyBaseLogger;

beforeEach(() => {
  vi.clearAllMocks();
  // Real caches rather than mocked ones, so a stale entry cannot make a test
  // pass by answering from a previous one.
  trendingCacheDeletePrefix("ai-recs:");
  watchedImdbIdsCache.clear();

  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(aiResponse(ONE_REC));

  readSecretKv.mockResolvedValue(JSON.stringify(CONFIG));
  resolveAiProviderUrl.mockResolvedValue(true);

  prismaMock.watchEvent.findMany.mockResolvedValue([]);
  prismaMock.metadata.findMany.mockResolvedValue([]);
  prismaMock.rating.findMany.mockResolvedValue([]);
  prismaMock.kV.findUnique.mockResolvedValue(null);
  prismaMock.kV.upsert.mockResolvedValue({});

  search.mockResolvedValue([
    { imdbId: "tt0113277", name: "Heat", year: 1995, poster: "/heat.jpg", genres: ["Crime"], rating: 8.3 },
  ]);
  upsertMetadata.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The body the provider was actually POSTed. */
const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);
const sentInit = () => fetchMock.mock.calls[0][1] as RequestInit;

describe("getAiConfig", () => {
  it("reads the config through the encrypted store", async () => {
    expect(await getAiConfig()).toEqual(CONFIG);
    expect(readSecretKv).toHaveBeenCalledWith(AI_CONFIG_KEY);
  });

  it("is null when nothing is stored", async () => {
    readSecretKv.mockResolvedValue(null);
    expect(await getAiConfig()).toBeNull();
  });

  it("is null rather than throwing when the stored blob is not JSON", async () => {
    // What an API_TOKEN rotation leaves behind: the row decrypts to nothing
    // usable. "Not configured" is the right reading; a throw would take down
    // whatever asked.
    readSecretKv.mockResolvedValue("not json");
    expect(await getAiConfig()).toBeNull();
  });
});

describe("isAiConfigured", () => {
  it("needs a url, headers and a model", async () => {
    expect(await isAiConfigured()).toBe(true);
  });

  it.each([
    ["url", { ...CONFIG, url: "" }],
    ["headers", { ...CONFIG, headers: undefined }],
    ["model", { ...CONFIG, payload: { max_tokens: 4096 } }],
  ])("is false without a %s", async (_field, config) => {
    readSecretKv.mockResolvedValue(JSON.stringify(config));
    expect(await isAiConfigured()).toBe(false);
  });
});

describe("redactAiConfig", () => {
  it("masks the Authorization header whatever its casing", () => {
    const redacted = redactAiConfig({ ...CONFIG, headers: { authorization: "Bearer sk-secret-value" } });

    expect(redacted.headers.authorization).toBe("Bearer ****");
    expect(JSON.stringify(redacted)).not.toContain("sk-secret-value");
  });

  it("leaves other headers alone — they are not the credential", () => {
    const redacted = redactAiConfig({ ...CONFIG, headers: { "X-Org": "acme", Authorization: "Bearer x" } });

    expect(redacted.headers["X-Org"]).toBe("acme");
  });

  it("reports the clamped max_tokens, not the stale saved one", () => {
    const redacted = redactAiConfig({ ...CONFIG, payload: { model: "m", max_tokens: 1024 } });

    expect(redacted.payload.max_tokens).toBe(2048);
  });
});

describe("the outbound request", () => {
  it("carries the configured headers alongside a JSON content type", async () => {
    await getAiRecommendations("movie", 1, undefined, logger);

    expect(fetchMock).toHaveBeenCalledWith(CONFIG.url, expect.anything());
    expect(sentInit().headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-secret-value",
    });
  });

  it("refuses to follow a redirect", async () => {
    // An allowed host must not be able to bounce the request — Authorization
    // header and all — at an address the SSRF check would have rejected.
    await getAiRecommendations("movie", 1, undefined, logger);

    expect(sentInit().redirect).toBe("error");
  });

  it("is abortable, so a provider that never answers does not hold the request", async () => {
    await getAiRecommendations("movie", 1, undefined, logger);

    expect(sentInit().signal).toBeInstanceOf(AbortSignal);
  });

  it("asks for a non-streaming completion carrying the prompt", async () => {
    await getAiRecommendations("movie", 1, undefined, logger);

    const body = sentBody();
    expect(body).toMatchObject({ model: "gpt-4o-mini", stream: false });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });

  it("re-resolves the URL before every call, not once at save time", async () => {
    // A hostname's DNS records can change between being saved and being used.
    await getAiRecommendations("movie", 1, undefined, logger);

    expect(resolveAiProviderUrl).toHaveBeenCalledWith(CONFIG.url);
  });

  it("sends nothing at all when the URL resolves to a blocked target", async () => {
    resolveAiProviderUrl.mockResolvedValue(false);

    expect(await getAiRecommendations("movie", 1, undefined, logger)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not echo the provider's response body on an error status", async () => {
    // Reflecting it would turn this into an SSRF probe that reads internal
    // responses back to whoever asked for recommendations.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ secret: "internal-service-response" }),
      text: async () => "internal-service-response",
    });

    expect(await getAiRecommendations("movie", 1, undefined, logger)).toBeNull();
    expect(JSON.stringify(loggerMocks.error.mock.calls)).not.toContain("internal-service-response");
    expect(loggerMocks.error.mock.calls[0][0]).toMatchObject({ message: "AI provider error (403)" });
  });
});

describe("the max_tokens floor", () => {
  it("raises a saved value low enough to truncate the response", async () => {
    readSecretKv.mockResolvedValue(JSON.stringify({ ...CONFIG, payload: { model: "m", max_tokens: 512 } }));

    await getAiRecommendations("movie", 1, undefined, logger);

    expect(sentBody().max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it("scales with how many recommendations were asked for", async () => {
    await getAiRecommendations("movie", 50, undefined, logger);

    // 400 base + 150 per recommendation, which is above the 2048 floor by 50.
    expect(sentBody().max_tokens).toBe(7900);
  });

  it("keeps a configured value that is already higher", async () => {
    readSecretKv.mockResolvedValue(JSON.stringify({ ...CONFIG, payload: { model: "m", max_tokens: 32000 } }));

    await getAiRecommendations("movie", 1, undefined, logger);

    expect(sentBody().max_tokens).toBe(32000);
  });
});

describe("reading the provider's answer", () => {
  const recommends = async () => {
    const result = await getAiRecommendations("movie", 1, undefined, logger);
    return result?.metas.map((meta) => meta.name) ?? null;
  };

  it("takes a bare JSON array", async () => {
    expect(await recommends()).toEqual(["Heat"]);
  });

  it("takes an array fenced in a markdown code block", async () => {
    fetchMock.mockResolvedValue(aiResponse("```json\n" + ONE_REC + "\n```"));
    expect(await recommends()).toEqual(["Heat"]);
  });

  it("strips a reasoning model's <think> block", async () => {
    fetchMock.mockResolvedValue(aiResponse(`<think>Let me consider...</think>${ONE_REC}`));
    expect(await recommends()).toEqual(["Heat"]);
  });

  it("takes an array with commentary after it", async () => {
    // Bracket-matching rather than a greedy regex, which would overshoot to the
    // "]" in the trailing text.
    fetchMock.mockResolvedValue(aiResponse(`${ONE_REC}\n\nHope that helps [let me know]!`));
    expect(await recommends()).toEqual(["Heat"]);
  });

  it("gives up on a response with no array in it", async () => {
    fetchMock.mockResolvedValue(aiResponse("I'm afraid I can't do that."));

    expect(await getAiRecommendations("movie", 1, undefined, logger)).toBeNull();
  });

  it("says a truncated reasoning block needs more headroom, not better parsing", async () => {
    fetchMock.mockResolvedValue(aiResponse("<think>Considering the user's taste in crime"));

    expect(await getAiRecommendations("movie", 1, undefined, logger)).toBeNull();
    expect(loggerMocks.error.mock.calls[0][0]).toMatchObject({ message: expect.stringMatching(/max_tokens/) });
  });
});

describe("excluding what has already been watched", () => {
  it("drops a recommendation for a title in the watch history", async () => {
    prismaMock.watchEvent.findMany.mockResolvedValue([
      { imdbId: "tt0113277", type: "movie", seriesImdbId: null },
    ]);

    const result = await getAiRecommendations("movie", 1, "profile-1", logger);

    expect(result?.metas).toEqual([]);
  });

  it("keeps one that is not", async () => {
    prismaMock.watchEvent.findMany.mockResolvedValue([
      { imdbId: "tt0111161", type: "movie", seriesImdbId: null },
    ]);

    const result = await getAiRecommendations("movie", 1, "profile-1", logger);

    expect(result?.metas.map((meta) => meta.id)).toEqual(["tt0113277"]);
  });
});

describe("shouldRefreshAiRecs", () => {
  it("is false when no provider is configured", async () => {
    readSecretKv.mockResolvedValue(null);

    expect(await shouldRefreshAiRecs()).toBe(false);
    expect(prismaMock.kV.findUnique).not.toHaveBeenCalled();
  });

  it("is true when nothing has been generated yet", async () => {
    expect(await shouldRefreshAiRecs()).toBe(true);
  });

  it("is false a day after the last generation", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    prismaMock.kV.findUnique.mockResolvedValue({ value: yesterday });

    expect(await shouldRefreshAiRecs()).toBe(false);
  });

  it("is true a week after the last generation", async () => {
    const lastWeek = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    prismaMock.kV.findUnique.mockResolvedValue({ value: lastWeek });

    expect(await shouldRefreshAiRecs()).toBe(true);
  });

  it("is true when the stored timestamp is unreadable", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({ value: "whenever" });

    expect(await shouldRefreshAiRecs()).toBe(true);
  });
});
