import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = { kV: { findUnique: vi.fn() } };
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./settings.js", () => ({ getLanguageSetting: vi.fn(async () => "fr-FR") }));

const { getTmdbApiKey, getTmdb, TMDB_API_KEY_KV } = await import("./tmdb-client.js");

const ORIGINAL_ENV_KEY = process.env.TMDB_API_KEY;

beforeEach(() => {
  prismaMock.kV.findUnique.mockReset().mockResolvedValue(null);
  delete process.env.TMDB_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_ENV_KEY === undefined) delete process.env.TMDB_API_KEY;
  else process.env.TMDB_API_KEY = ORIGINAL_ENV_KEY;
});

describe("getTmdbApiKey", () => {
  it("prefers a key saved from Settings over the environment", async () => {
    process.env.TMDB_API_KEY = "from-env";
    prismaMock.kV.findUnique.mockResolvedValue({ key: TMDB_API_KEY_KV, value: "from-settings" });

    await expect(getTmdbApiKey()).resolves.toEqual({ apiKey: "from-settings", source: "db" });
  });

  it("falls back to the environment when nothing is saved", async () => {
    process.env.TMDB_API_KEY = "from-env";

    await expect(getTmdbApiKey()).resolves.toEqual({ apiKey: "from-env", source: "env" });
  });

  // A row left holding whitespace is as good as no key, and must not shadow a
  // working environment variable.
  it("treats a blank saved key as absent", async () => {
    process.env.TMDB_API_KEY = "from-env";
    prismaMock.kV.findUnique.mockResolvedValue({ key: TMDB_API_KEY_KV, value: "   " });

    await expect(getTmdbApiKey()).resolves.toEqual({ apiKey: "from-env", source: "env" });
  });

  it("reports no key when neither source has one", async () => {
    await expect(getTmdbApiKey()).resolves.toEqual({ apiKey: null, source: null });
  });
});

describe("getTmdb", () => {
  it("builds a client on the saved key and the configured language", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({ key: TMDB_API_KEY_KV, value: "from-settings" });

    const client = await getTmdb();

    expect(client.getLanguage()).toBe("fr-FR");
  });

  it("throws when no key is configured", async () => {
    await expect(getTmdb()).rejects.toThrow("TMDB_API_KEY is not configured");
  });
});
