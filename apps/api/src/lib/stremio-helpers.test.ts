import { beforeEach, describe, expect, it, vi } from "vitest";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "99999999-9999-4999-8999-999999999999";

const prismaMock = {
  listItem: { findMany: vi.fn() },
  item: { findMany: vi.fn() },
  metadata: { findMany: vi.fn() },
  watchEvent: { groupBy: vi.fn() },
  seriesProgress: { findMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./rpdb.js", () => ({
  getRpdbApiKey: vi.fn(async () => null),
  withRpdbPoster: (_id: string, poster: string | null | undefined) => poster ?? null,
}));
vi.mock("./watchlist.js", () => ({
  getDefaultWatchlist: vi.fn(async () => ({ id: WATCHLIST_ID })),
}));
vi.mock("./dropped-shows.js", () => ({
  getDroppedSeriesIds: vi.fn(async () => new Set<string>()),
}));
vi.mock("./metadata.js", () => ({ backfillMissingMetadata: vi.fn() }));

const load = async () => import("./stremio-helpers.js");

describe("list catalog helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prismaMock.item.findMany.mockResolvedValue([]);
    prismaMock.metadata.findMany.mockResolvedValue([]);
  });

  const seedList = (names: string[]) => {
    prismaMock.listItem.findMany.mockResolvedValue(names.map((_, i) => ({ imdbId: `tt${i}` })));
    prismaMock.metadata.findMany.mockResolvedValue(
      names.map((name, i) => ({
        imdbId: `tt${i}`,
        name,
        poster: null,
        year: null,
        description: null,
        genres: [],
        rating: null,
      }))
    );
  };

  it("caps the watchlist scan instead of fetching every row", async () => {
    seedList(["Zulu", "Alpha", "Mike"]);
    const { getWatchlistMetas } = await load();

    await getWatchlistMetas("movie", 2, PROFILE_ID);

    const args = prismaMock.listItem.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ listId: WATCHLIST_ID, type: "movie" });
    expect(args.take).toBeGreaterThan(0);
    expect(args.orderBy).toEqual({ addedAt: "desc" });
  });

  it("still returns the alphabetically-first page up to the limit", async () => {
    seedList(["Zulu", "Alpha", "Mike"]);
    const { getWatchlistMetas } = await load();

    const metas = await getWatchlistMetas("movie", 2, PROFILE_ID);

    expect(metas.map((m) => m.name)).toEqual(["Alpha", "Mike"]);
  });

  it("caps the custom-list scan the same way", async () => {
    seedList(["Bravo", "Alpha"]);
    const { getCustomListMetas } = await load();

    const metas = await getCustomListMetas("list-1", "series", 10);

    const args = prismaMock.listItem.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ listId: "list-1", type: "series" });
    expect(args.take).toBeGreaterThan(0);
    expect(metas.map((m) => m.name)).toEqual(["Alpha", "Bravo"]);
  });
});
