import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RatingInput } from "./batch-ratings.js";

const prismaMock = {
  rating: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const RATED_AT = new Date("2024-01-01T00:00:00Z");

const rating = (overrides: Partial<RatingInput> = {}): RatingInput => ({
  type: "movie",
  imdbId: "tt1",
  season: 0,
  episode: 0,
  rating: 8,
  ratedAt: RATED_AT,
  ...overrides,
});

const load = async () => (await import("./batch-ratings.js")).batchUpsertRatings;

/** Every row handed to a `createMany` call, flattened across chunks. */
const createdRows = () =>
  prismaMock.rating.createMany.mock.calls.flatMap((call) => (call[0] as { data: unknown[] }).data);

describe("batchUpsertRatings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    prismaMock.rating.findMany.mockResolvedValue([]);
    prismaMock.rating.createMany.mockResolvedValue({ count: 0 });
    prismaMock.rating.updateMany.mockResolvedValue({ count: 0 });
  });

  it("does no database work for an empty batch", async () => {
    const batchUpsertRatings = await load();

    expect(await batchUpsertRatings(PROFILE_ID, [])).toBe(0);
    expect(prismaMock.rating.findMany).not.toHaveBeenCalled();
    expect(prismaMock.rating.createMany).not.toHaveBeenCalled();
  });

  it("lets a later row in the batch win over an earlier one for the same key", async () => {
    const batchUpsertRatings = await load();

    const written = await batchUpsertRatings(PROFILE_ID, [
      rating({ rating: 4 }),
      rating({ rating: 9, note: "changed my mind" }),
    ]);

    expect(written).toBe(1);
    expect(createdRows()).toEqual([
      expect.objectContaining({ imdbId: "tt1", rating: 9, note: "changed my mind" }),
    ]);
  });

  it("treats the same title as distinct rows per type and per episode", async () => {
    const batchUpsertRatings = await load();

    await batchUpsertRatings(PROFILE_ID, [
      rating({ imdbId: "tt1", type: "series", rating: 7 }),
      rating({ imdbId: "tt1", type: "episode", season: 1, episode: 2, rating: 8 }),
      rating({ imdbId: "tt1", type: "episode", season: 1, episode: 3, rating: 9 }),
    ]);

    expect(createdRows()).toHaveLength(3);
  });

  it("inserts what's new and updates what already exists", async () => {
    prismaMock.rating.findMany.mockResolvedValue([
      { type: "movie", imdbId: "tt2", season: 0, episode: 0 },
    ]);
    const batchUpsertRatings = await load();

    await batchUpsertRatings(PROFILE_ID, [
      rating({ imdbId: "tt1", rating: 8 }),
      rating({ imdbId: "tt2", rating: 9, note: "rewatch" }),
    ]);

    expect(createdRows()).toEqual([
      expect.objectContaining({ profileId: PROFILE_ID, imdbId: "tt1", rating: 8, note: null }),
    ]);
    expect(prismaMock.rating.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.rating.updateMany).toHaveBeenCalledWith({
      where: { profileId: PROFILE_ID, type: "movie", imdbId: "tt2", season: 0, episode: 0 },
      data: { rating: 9, ratedAt: RATED_AT, note: "rewatch" },
    });
  });

  it("matches an existing row only when the whole key matches", async () => {
    // Same title, different episode — this is an insert, not an update.
    prismaMock.rating.findMany.mockResolvedValue([
      { type: "episode", imdbId: "tt1", season: 1, episode: 2 },
    ]);
    const batchUpsertRatings = await load();

    await batchUpsertRatings(PROFILE_ID, [rating({ type: "episode", season: 1, episode: 3 })]);

    expect(createdRows()).toHaveLength(1);
    expect(prismaMock.rating.updateMany).not.toHaveBeenCalled();
  });

  it("splits a batch larger than the chunk size across several inserts", async () => {
    const batchUpsertRatings = await load();
    const inputs = Array.from({ length: 2_500 }, (_, i) => rating({ imdbId: `tt${i}` }));

    const written = await batchUpsertRatings(PROFILE_ID, inputs);

    expect(written).toBe(2_500);
    // 2500 rows at 1000 per statement — Postgres caps a statement's bind
    // parameters, so this must not go out as one insert.
    expect(prismaMock.rating.createMany).toHaveBeenCalledTimes(3);
    expect(prismaMock.rating.createMany.mock.calls.map((call) => (call[0] as { data: unknown[] }).data.length))
      .toEqual([1_000, 1_000, 500]);
    expect(createdRows()).toHaveLength(2_500);
    // The lookup of colliding rows is chunked the same way.
    expect(prismaMock.rating.findMany).toHaveBeenCalledTimes(3);
  });

  it("inserts with skipDuplicates so a concurrent write can't fail the import", async () => {
    const batchUpsertRatings = await load();

    await batchUpsertRatings(PROFILE_ID, [rating()]);

    expect(prismaMock.rating.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
  });
});
