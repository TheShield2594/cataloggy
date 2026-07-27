import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataType } from "@prisma/client";

const prismaMock = {
  metadata: { findUnique: vi.fn(), upsert: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const tmdbMock = { findByImdbId: vi.fn() };
vi.mock("./tmdb-client.js", () => ({ getTmdb: vi.fn(async () => tmdbMock) }));

const omdbMock = {
  getOmdbApiKey: vi.fn(async () => null),
  fetchOmdbRatings: vi.fn(),
  upsertOmdbRatings: vi.fn(),
};
vi.mock("./omdb.js", () => omdbMock);

// The real cooldown is an LRU with a 6h TTL; a plain Set gives the same
// has/set surface while staying inspectable and resettable per test.
const cooldownKeys = new Set<string>();
vi.mock("./cache.js", () => ({
  metadataBackfillCooldownCache: {
    has: (key: string) => cooldownKeys.has(key),
    set: (key: string) => cooldownKeys.add(key),
  },
}));

const { backfillMissingMetadata } = await import("./metadata.js");

const payloadFor = (imdbId: string) => ({
  imdbId,
  type: MetadataType.movie,
  tmdbId: 1,
  name: "Perfect Blue",
  year: 1997,
  poster: null,
  background: null,
  description: null,
  genres: [],
  rating: null,
  voteCount: null,
  totalSeasons: null,
  totalEpisodes: null,
  runtime: 81,
  certification: "R",
  status: "Released",
  network: null,
  releaseDate: "1997-08-05",
});

const movies = (...ids: string[]) => ids.map((imdbId) => ({ imdbId, type: MetadataType.movie }));

const settle = () => vi.waitFor(() => expect(tmdbMock.findByImdbId).toHaveBeenCalled());

describe("backfillMissingMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cooldownKeys.clear();
    prismaMock.metadata.findUnique.mockResolvedValue(null);
    prismaMock.metadata.upsert.mockImplementation(async ({ create }: { create: unknown }) => create);
    omdbMock.getOmdbApiKey.mockResolvedValue(null);
  });

  it("returns synchronously without waiting on the syncs", () => {
    tmdbMock.findByImdbId.mockResolvedValue(payloadFor("tt0000001"));

    expect(backfillMissingMetadata(movies("tt0000001"))).toBeUndefined();
  });

  it("writes a metadata row for an item that has none", async () => {
    tmdbMock.findByImdbId.mockResolvedValue(payloadFor("tt0000002"));

    backfillMissingMetadata(movies("tt0000002"));

    await vi.waitFor(() => expect(prismaMock.metadata.upsert).toHaveBeenCalledTimes(1));
    expect(prismaMock.metadata.upsert.mock.calls[0][0].create.name).toBe("Perfect Blue");
  });

  it("caps how many items one call syncs so a bulk import cannot stampede TMDB", async () => {
    tmdbMock.findByImdbId.mockResolvedValue(payloadFor("tt1"));
    const ids = Array.from({ length: 60 }, (_, i) => `tt${String(i).padStart(7, "0")}`);

    backfillMissingMetadata(movies(...ids));

    await settle();
    await vi.waitFor(() => expect(tmdbMock.findByImdbId).toHaveBeenCalledTimes(25));
    expect(tmdbMock.findByImdbId).toHaveBeenCalledTimes(25);
  });

  it("parks an item that TMDB cannot resolve and skips it on the next call", async () => {
    tmdbMock.findByImdbId.mockResolvedValue(null);

    backfillMissingMetadata(movies("tt0000003"));
    await vi.waitFor(() => expect(cooldownKeys.has(`tt0000003:${MetadataType.movie}`)).toBe(true));

    tmdbMock.findByImdbId.mockClear();
    backfillMissingMetadata(movies("tt0000003"));

    expect(tmdbMock.findByImdbId).not.toHaveBeenCalled();
  });

  it("parks an item whose sync throws rather than retrying it on every read", async () => {
    tmdbMock.findByImdbId.mockRejectedValue(new Error("TMDB down"));
    const log = { warn: vi.fn() };

    backfillMissingMetadata(movies("tt0000004"), log);

    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));
    expect(cooldownKeys.has(`tt0000004:${MetadataType.movie}`)).toBe(true);
  });

  it("does not start a second sync for an item already in flight", async () => {
    let release: (value: null) => void = () => {};
    tmdbMock.findByImdbId.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    backfillMissingMetadata(movies("tt0000005"));
    await settle();
    backfillMissingMetadata(movies("tt0000005"));

    expect(tmdbMock.findByImdbId).toHaveBeenCalledTimes(1);
    release(null);
  });

  it("skips the work entirely when nothing is missing", () => {
    backfillMissingMetadata([]);

    expect(tmdbMock.findByImdbId).not.toHaveBeenCalled();
  });
});
