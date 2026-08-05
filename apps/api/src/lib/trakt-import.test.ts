import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { TraktClient } from "../trakt.js";

const makeLogger = (): FastifyBaseLogger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    child: vi.fn(),
  }) as unknown as FastifyBaseLogger;

const prismaMock = {
  item: { upsert: vi.fn() },
  list: { findFirst: vi.fn(), create: vi.fn() },
  listItem: { create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const batchRatingsMock = { batchUpsertRatings: vi.fn() };
vi.mock("./batch-ratings.js", () => batchRatingsMock);

const collectionMock = { getDefaultCollection: vi.fn() };
vi.mock("./collection.js", () => collectionMock);

// A stub standing in for the parts of TraktClient each import touches.
const makeClient = (overrides: Partial<Record<string, unknown>>): TraktClient =>
  ({
    fetchRatedMovies: vi.fn().mockResolvedValue([]),
    fetchRatedShows: vi.fn().mockResolvedValue([]),
    fetchRatedSeasons: vi.fn().mockResolvedValue([]),
    fetchRatedEpisodes: vi.fn().mockResolvedValue([]),
    fetchCollectionMovies: vi.fn().mockResolvedValue([]),
    fetchCollectionShows: vi.fn().mockResolvedValue([]),
    fetchPersonalLists: vi.fn().mockResolvedValue([]),
    fetchPersonalListItems: vi.fn().mockResolvedValue([]),
    ...overrides,
  }) as unknown as TraktClient;

const duplicateError = () =>
  new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" });

describe("trakt-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.item.upsert.mockResolvedValue({});
    prismaMock.listItem.create.mockResolvedValue({});
    collectionMock.getDefaultCollection.mockResolvedValue({ id: "collection-1" });
    batchRatingsMock.batchUpsertRatings.mockResolvedValue(0);
  });

  describe("importTraktRatings", () => {
    it("maps movie, show, season and episode ratings onto the scale and keys Cataloggy stores", async () => {
      const client = makeClient({
        fetchRatedMovies: vi
          .fn()
          .mockResolvedValue([{ rating: 9, rated_at: "2021-05-01T10:00:00Z", movie: { ids: { imdb: "tt1" } } }]),
        fetchRatedShows: vi
          .fn()
          .mockResolvedValue([{ rating: 7, rated_at: "2022-06-02T10:00:00Z", show: { ids: { imdb: "tt2" } } }]),
        fetchRatedSeasons: vi.fn().mockResolvedValue([
          { rating: 8, rated_at: "2022-08-04T10:00:00Z", season: { number: 3 }, show: { ids: { imdb: "tt2" } } },
          // Season 0 is Specials, and rating it must not collide with the
          // show's own rating the way a series row keyed on season 0 would.
          { rating: 4, rated_at: "2022-08-05T10:00:00Z", season: { number: 0 }, show: { ids: { imdb: "tt2" } } },
        ]),
        fetchRatedEpisodes: vi.fn().mockResolvedValue([
          {
            rating: 10,
            rated_at: "2023-07-03T10:00:00Z",
            episode: { season: 3, number: 8, ids: { imdb: "tt-ep" } },
            show: { ids: { imdb: "tt2" } },
          },
        ]),
      });

      const { importTraktRatings } = await import("./trakt-import.js");
      const result = await importTraktRatings(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ movies: 1, shows: 1, seasons: 2, episodes: 1, skipped: 0 });
      expect(batchRatingsMock.batchUpsertRatings).toHaveBeenCalledWith("profile-1", [
        { type: "movie", imdbId: "tt1", season: 0, episode: 0, rating: 9, ratedAt: new Date("2021-05-01T10:00:00Z") },
        { type: "series", imdbId: "tt2", season: 0, episode: 0, rating: 7, ratedAt: new Date("2022-06-02T10:00:00Z") },
        { type: "season", imdbId: "tt2", season: 3, episode: 0, rating: 8, ratedAt: new Date("2022-08-04T10:00:00Z") },
        { type: "season", imdbId: "tt2", season: 0, episode: 0, rating: 4, ratedAt: new Date("2022-08-05T10:00:00Z") },
        // Keyed by the series, not the episode's own IMDb id — the convention
        // the ratings API reads back with.
        { type: "episode", imdbId: "tt2", season: 3, episode: 8, rating: 10, ratedAt: new Date("2023-07-03T10:00:00Z") },
      ]);
    });

    it("skips entries with no IMDb id or an unusable rating instead of writing a wrong one", async () => {
      const client = makeClient({
        fetchRatedMovies: vi.fn().mockResolvedValue([
          { rating: 8, movie: { ids: { imdb: null } } },
          { rating: 0, movie: { ids: { imdb: "tt1" } } },
          { rating: 11, movie: { ids: { imdb: "tt2" } } },
          { movie: { ids: { imdb: "tt3" } } },
        ]),
        fetchRatedSeasons: vi.fn().mockResolvedValue([{ rating: 5, show: { ids: { imdb: "tt5" } } }]),
        fetchRatedEpisodes: vi
          .fn()
          .mockResolvedValue([{ rating: 6, episode: { season: 1 }, show: { ids: { imdb: "tt4" } } }]),
      });

      const { importTraktRatings } = await import("./trakt-import.js");
      const result = await importTraktRatings(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ movies: 0, shows: 0, seasons: 0, episodes: 0, skipped: 6 });
      expect(batchRatingsMock.batchUpsertRatings).toHaveBeenCalledWith("profile-1", []);
    });
  });

  describe("importTraktCollection", () => {
    it("files collected movies and shows in the Collection list", async () => {
      const client = makeClient({
        fetchCollectionMovies: vi.fn().mockResolvedValue([{ movie: { ids: { imdb: "tt1" } } }]),
        fetchCollectionShows: vi.fn().mockResolvedValue([{ show: { ids: { imdb: "tt2" } } }]),
      });

      const { importTraktCollection } = await import("./trakt-import.js");
      const result = await importTraktCollection(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ movies: 1, shows: 1, skipped: 0 });
      expect(prismaMock.listItem.create).toHaveBeenCalledWith({
        data: { listId: "collection-1", type: "movie", imdbId: "tt1" },
      });
      expect(prismaMock.listItem.create).toHaveBeenCalledWith({
        data: { listId: "collection-1", type: "series", imdbId: "tt2" },
      });
    });

    it("counts an item already in the list as unchanged rather than failing the import", async () => {
      prismaMock.listItem.create.mockRejectedValue(duplicateError());
      const client = makeClient({
        fetchCollectionMovies: vi.fn().mockResolvedValue([{ movie: { ids: { imdb: "tt1" } } }]),
      });

      const { importTraktCollection } = await import("./trakt-import.js");
      const result = await importTraktCollection(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ movies: 0, skipped: 0 });
    });
  });

  describe("importTraktPersonalLists", () => {
    it("creates a custom list per Trakt list and fills it with its movies and shows", async () => {
      prismaMock.list.findFirst.mockResolvedValue(null);
      prismaMock.list.create.mockResolvedValue({ id: "list-1" });
      const client = makeClient({
        fetchPersonalLists: vi.fn().mockResolvedValue([{ ids: { trakt: 42 }, name: "Comfort films" }]),
        fetchPersonalListItems: vi.fn().mockResolvedValue([
          { type: "movie", movie: { ids: { imdb: "tt1" } } },
          { type: "show", show: { ids: { imdb: "tt2" } } },
          { type: "person", person: { ids: { imdb: "nm1" } } },
        ]),
      });

      const { importTraktPersonalLists } = await import("./trakt-import.js");
      const result = await importTraktPersonalLists(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ lists: 1, items: 2, skipped: 1 });
      expect(prismaMock.list.create).toHaveBeenCalledWith({
        data: { profileId: "profile-1", kind: "custom", name: "Comfort films" },
      });
    });

    it("fills a list that already exists here rather than creating a second one", async () => {
      prismaMock.list.findFirst.mockResolvedValue({ id: "existing-1" });
      const client = makeClient({
        fetchPersonalLists: vi.fn().mockResolvedValue([{ ids: { trakt: 42 }, name: "Comfort films" }]),
        fetchPersonalListItems: vi.fn().mockResolvedValue([{ type: "movie", movie: { ids: { imdb: "tt1" } } }]),
      });

      const { importTraktPersonalLists } = await import("./trakt-import.js");
      const result = await importTraktPersonalLists(client, makeLogger(), "profile-1");

      expect(result).toMatchObject({ lists: 0, items: 1 });
      expect(prismaMock.list.create).not.toHaveBeenCalled();
      expect(prismaMock.listItem.create).toHaveBeenCalledWith({
        data: { listId: "existing-1", type: "movie", imdbId: "tt1" },
      });
    });

    it("keeps importing the other lists when one of them can't be read", async () => {
      prismaMock.list.findFirst.mockResolvedValue(null);
      prismaMock.list.create.mockResolvedValue({ id: "list-2" });
      const client = makeClient({
        fetchPersonalLists: vi.fn().mockResolvedValue([
          { ids: { trakt: 1 }, name: "Broken" },
          { ids: { trakt: 2 }, name: "Fine" },
        ]),
        fetchPersonalListItems: vi
          .fn()
          .mockRejectedValueOnce(new Error("500 from Trakt"))
          .mockResolvedValueOnce([{ type: "movie", movie: { ids: { imdb: "tt1" } } }]),
      });

      const { importTraktPersonalLists } = await import("./trakt-import.js");
      const logger = makeLogger();
      const result = await importTraktPersonalLists(client, logger, "profile-1");

      expect(result).toMatchObject({ lists: 1, items: 1, skipped: 1 });
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
