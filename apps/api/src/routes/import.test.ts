import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const tmdbMock = { search: vi.fn() };
vi.mock("../lib/tmdb-client.js", () => ({ getTmdb: async () => tmdbMock }));

const batchMocks = {
  batchUpsertWatchEvents: vi.fn(),
  batchUpsertRatings: vi.fn(),
};
vi.mock("../lib/batch-watch-events.js", () => ({
  batchUpsertWatchEvents: (...args: unknown[]) => batchMocks.batchUpsertWatchEvents(...args),
}));
vi.mock("../lib/batch-ratings.js", () => ({
  batchUpsertRatings: (...args: unknown[]) => batchMocks.batchUpsertRatings(...args),
}));

/** Big enough to hold the row-cap payloads; production sets this from MAX_BODY_SIZE_MB. */
const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./import.js"), { bodyLimit: 256 * 1024 * 1024 });

const csvWithRows = (header: string, row: string, count: number) =>
  [header, ...Array.from({ length: count }, () => row)].join("\n");

describe("POST /import/external — row caps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tmdbMock.search.mockResolvedValue([]);
    batchMocks.batchUpsertWatchEvents.mockResolvedValue(0);
    batchMocks.batchUpsertRatings.mockResolvedValue(0);
  });

  it("rejects a Letterboxd export past the TMDB lookup cap without searching TMDB", async () => {
    const app = await buildApp();
    const csv = csvWithRows("Name,Year,Rating,Watched Date", "A Film,2024,4,2024-01-01", 10_001);

    const response = await app.inject({
      method: "POST",
      url: "/import/external",
      payload: { format: "letterboxd-diary", csv },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe("too_many_rows");
    expect(response.json().error).toContain("10,000");
    expect(tmdbMock.search).not.toHaveBeenCalled();
  });

  it("accepts an id-carrying format at a row count the Letterboxd cap would reject", async () => {
    const app = await buildApp();
    const csv = csvWithRows("Const,Your Rating,Date Rated,Title Type", "tt1,8,2024-01-01,movie", 10_001);

    const response = await app.inject({
      method: "POST",
      url: "/import/external",
      payload: { format: "imdb-ratings", csv },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().summary.ratingsImported).toBe(10_001);
  });

  it("still rejects an id-carrying format past the global import cap", async () => {
    const app = await buildApp();
    const csv = csvWithRows("Const,Your Rating,Date Rated,Title Type", "tt1,8,2024-01-01,movie", 200_001);

    const response = await app.inject({
      method: "POST",
      url: "/import/external",
      payload: { format: "imdb-ratings", csv },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error).toContain("200,000");
    expect(batchMocks.batchUpsertRatings).not.toHaveBeenCalled();
  });
});
