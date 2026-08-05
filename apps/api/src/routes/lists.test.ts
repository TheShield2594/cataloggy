import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../lib/test-fixtures/route-app.js";
import { P2002 } from "../lib/test-fixtures/prisma-errors.js";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const LIST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_LIST_ID = "33333333-3333-4333-8333-333333333333";

const prismaMock = {
  list: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  listItem: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  item: { upsert: vi.fn(), findMany: vi.fn() },
  metadata: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

const syncMetadata = vi.fn();
const backfillMissingMetadata = vi.fn();
const pushTraktWatchlistChange = vi.fn();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/metadata.js", () => ({
  syncMetadata: (...args: unknown[]) => syncMetadata(...args),
  backfillMissingMetadata: (...args: unknown[]) => backfillMissingMetadata(...args),
}));
vi.mock("../lib/trakt-client.js", () => ({
  pushTraktWatchlistChange: (...args: unknown[]) => pushTraktWatchlistChange(...args),
}));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = (): Promise<FastifyInstance> =>
  buildRouteApp(() => import("./lists.js"));

const listRow = (over: Record<string, unknown> = {}) => ({
  id: LIST_ID,
  name: "Watchlist",
  kind: "watchlist",
  profileId: PROFILE_ID,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("lists routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncMetadata.mockResolvedValue(undefined);
    pushTraktWatchlistChange.mockResolvedValue(undefined);
    // The route runs its item upsert and list-item insert in one transaction;
    // running the callback against the same mock keeps assertions on the inner
    // calls working.
    prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prismaMock));
  });

  describe("POST /lists", () => {
    it("creates a list scoped to the calling profile", async () => {
      prismaMock.list.create.mockResolvedValue(listRow({ name: "Weekend", kind: "custom" }));
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/lists",
        payload: { name: "  Weekend  ", kind: "custom" },
      });

      expect(res.statusCode).toBe(201);
      expect(prismaMock.list.create).toHaveBeenCalledWith({
        data: { name: "Weekend", kind: "custom", profileId: PROFILE_ID },
      });
      expect(res.json().list).toMatchObject({ name: "Weekend", itemCount: 0 });
    });

    it("rejects a kind that is not one of the known list kinds", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/lists",
        payload: { name: "Weekend", kind: "favourites" },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.list.create).not.toHaveBeenCalled();
    });

    it("rejects a name that is only whitespace", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/lists",
        payload: { name: "   ", kind: "custom" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /lists", () => {
    it("returns each list with its item count", async () => {
      prismaMock.list.findMany.mockResolvedValue([
        { ...listRow(), _count: { items: 4 } },
        { ...listRow({ id: OTHER_LIST_ID, name: "Collection", kind: "collection" }), _count: { items: 0 } },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/lists" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.list.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID } })
      );
      expect(res.json().lists).toEqual([
        expect.objectContaining({ name: "Watchlist", itemCount: 4 }),
        expect.objectContaining({ name: "Collection", itemCount: 0 }),
      ]);
    });
  });

  describe("PATCH /lists/:id", () => {
    it("renames a list the profile owns", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.list.update.mockResolvedValue(listRow({ name: "Renamed" }));
      const app = await buildApp();

      const res = await app.inject({
        method: "PATCH",
        url: `/lists/${LIST_ID}`,
        payload: { name: "  Renamed  " },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.list.update).toHaveBeenCalledWith({
        where: { id: LIST_ID },
        data: { name: "Renamed" },
      });
    });

    it("rejects an id that is not a UUID before touching the database", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "PATCH", url: "/lists/not-a-uuid", payload: { name: "x" } });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.list.findFirst).not.toHaveBeenCalled();
    });

    it("404s on a list belonging to another profile", async () => {
      // The lookup is scoped by profileId, so another profile's list simply
      // isn't found — it must not be reported as existing-but-forbidden.
      prismaMock.list.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "PATCH", url: `/lists/${LIST_ID}`, payload: { name: "x" } });

      expect(res.statusCode).toBe(404);
      expect(prismaMock.list.update).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /lists/:id", () => {
    it("deletes a list the profile owns", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.list.delete.mockResolvedValue(listRow());
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}` });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.list.delete).toHaveBeenCalledWith({ where: { id: LIST_ID } });
    });

    it("404s when the list is not the profile's", async () => {
      prismaMock.list.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}` });

      expect(res.statusCode).toBe(404);
      expect(prismaMock.list.delete).not.toHaveBeenCalled();
    });
  });

  describe("POST /lists/:listId/items", () => {
    it("adds an item and mirrors the add to Trakt for a watchlist", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow({ kind: "watchlist" }));
      prismaMock.item.upsert.mockResolvedValue({});
      prismaMock.listItem.create.mockResolvedValue({ listId: LIST_ID, type: "movie", imdbId: "tt0111161" });
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: `/lists/${LIST_ID}/items`,
        payload: { type: "movie", imdbId: " tt0111161 ", title: " The Shawshank Redemption " },
      });

      expect(res.statusCode).toBe(201);
      expect(prismaMock.item.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { type_imdbId: { type: "movie", imdbId: "tt0111161" } },
        })
      );
      expect(pushTraktWatchlistChange).toHaveBeenCalledWith(
        "add",
        { type: "movie", imdbId: "tt0111161" },
        expect.anything()
      );
    });

    it("does not push to Trakt for a custom list", async () => {
      // Only the watchlist mirrors to Trakt; a custom list is local-only.
      prismaMock.list.findFirst.mockResolvedValue(listRow({ kind: "custom" }));
      prismaMock.item.upsert.mockResolvedValue({});
      prismaMock.listItem.create.mockResolvedValue({ listId: LIST_ID, type: "series", imdbId: "tt0903747" });
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: `/lists/${LIST_ID}/items`,
        payload: { type: "series", imdbId: "tt0903747" },
      });

      expect(res.statusCode).toBe(201);
      expect(pushTraktWatchlistChange).not.toHaveBeenCalled();
    });

    it("returns 409 rather than 500 when the item is already in the list", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.$transaction.mockRejectedValue(P2002);
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: `/lists/${LIST_ID}/items`,
        payload: { type: "movie", imdbId: "tt0111161" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatch(/already exists/i);
    });

    it("validates the body before looking the list up", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: `/lists/${LIST_ID}/items`,
        payload: { type: "book", imdbId: "tt0111161" },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.list.findFirst).not.toHaveBeenCalled();
    });

    it("rejects a non-string title instead of storing it", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: `/lists/${LIST_ID}/items`,
        payload: { type: "movie", imdbId: "tt1", title: 42 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /lists/:listId/items/:imdbId", () => {
    it("infers the type when exactly one item matches", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow({ kind: "custom" }));
      prismaMock.listItem.findMany.mockResolvedValue([{ type: "series" }]);
      prismaMock.listItem.deleteMany.mockResolvedValue({ count: 1 });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}/items/tt0903747` });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.listItem.deleteMany).toHaveBeenCalledWith({
        where: { listId: LIST_ID, imdbId: "tt0903747", type: "series" },
      });
    });

    it("asks for a type when a movie and a series share the imdbId", async () => {
      // Both rows would otherwise be deleted by one ambiguous request.
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.findMany.mockResolvedValue([{ type: "movie" }, { type: "series" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}/items/tt1` });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/type=movie or \?type=series/);
      expect(prismaMock.listItem.deleteMany).not.toHaveBeenCalled();
    });

    it("404s when nothing matches the imdbId", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}/items/tt1` });

      expect(res.statusCode).toBe(404);
    });

    it("mirrors the removal to Trakt for a watchlist", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow({ kind: "watchlist" }));
      prismaMock.listItem.deleteMany.mockResolvedValue({ count: 1 });
      const app = await buildApp();

      const res = await app.inject({
        method: "DELETE",
        url: `/lists/${LIST_ID}/items/tt1?type=movie`,
      });

      expect(res.statusCode).toBe(204);
      expect(pushTraktWatchlistChange).toHaveBeenCalledWith(
        "remove",
        { type: "movie", imdbId: "tt1" },
        expect.anything()
      );
    });
  });

  describe("DELETE /lists/:listId/items/:type/:imdbId", () => {
    it("deletes the row matching both type and imdbId", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow({ kind: "custom" }));
      prismaMock.listItem.deleteMany.mockResolvedValue({ count: 1 });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}/items/movie/tt1` });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.listItem.deleteMany).toHaveBeenCalledWith({
        where: { listId: LIST_ID, type: "movie", imdbId: "tt1" },
      });
    });

    it("404s when the row does not exist", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.deleteMany.mockResolvedValue({ count: 0 });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/lists/${LIST_ID}/items/movie/tt1` });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /lists/:listId/items", () => {
    it("joins metadata onto each item", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: LIST_ID, type: "movie", imdbId: "tt1", addedAt: new Date("2026-01-01T00:00:00Z") },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([
        { imdbId: "tt1", type: "movie", name: "A Movie", poster: null, year: 2020, genres: ["Drama"], rating: 7.5 },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: `/lists/${LIST_ID}/items` });

      expect(res.statusCode).toBe(200);
      expect(res.json().items[0].metadata).toMatchObject({ name: "A Movie", year: 2020 });
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });

    it("falls back to the captured title and schedules a backfill when metadata is missing", async () => {
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: LIST_ID, type: "movie", imdbId: "tt1", addedAt: new Date("2026-01-01T00:00:00Z") },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([{ imdbId: "tt1", type: "movie", title: "A Movie" }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: `/lists/${LIST_ID}/items` });

      expect(res.statusCode).toBe(200);
      expect(res.json().items[0]).toMatchObject({ title: "A Movie", metadata: null });
      expect(backfillMissingMetadata).toHaveBeenCalledWith(
        [{ imdbId: "tt1", type: "movie" }],
        expect.anything()
      );
    });

    it("keeps a movie and a series sharing an imdbId apart", async () => {
      // Metadata is keyed on imdbId *and* type — keying on imdbId alone would
      // show the movie's poster on the series row.
      prismaMock.list.findFirst.mockResolvedValue(listRow());
      prismaMock.listItem.findMany.mockResolvedValue([
        { listId: LIST_ID, type: "movie", imdbId: "tt1", addedAt: new Date("2026-01-02T00:00:00Z") },
        { listId: LIST_ID, type: "series", imdbId: "tt1", addedAt: new Date("2026-01-01T00:00:00Z") },
      ]);
      prismaMock.metadata.findMany.mockResolvedValue([
        { imdbId: "tt1", type: "movie", name: "The Movie", poster: null, year: 2020, genres: [], rating: null },
      ]);
      prismaMock.item.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: `/lists/${LIST_ID}/items` });

      const items = res.json().items;
      expect(items[0].metadata).toMatchObject({ name: "The Movie" });
      expect(items[1].metadata).toBeNull();
    });
  });

  describe("GET /items/:imdbId/lists", () => {
    it("reports every list of the profile holding the item", async () => {
      prismaMock.listItem.findMany.mockResolvedValue([
        {
          type: "movie",
          addedAt: new Date("2026-01-01T00:00:00Z"),
          list: { id: LIST_ID, name: "Watchlist", kind: "watchlist" },
        },
      ]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/items/tt1/lists" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.listItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ imdbId: "tt1", list: { profileId: PROFILE_ID } }),
        })
      );
      expect(res.json().lists[0]).toMatchObject({ listName: "Watchlist", listKind: "watchlist" });
    });

    it("ignores a type filter that is not a valid item type", async () => {
      prismaMock.listItem.findMany.mockResolvedValue([]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/items/tt1/lists?type=book" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.listItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ type: expect.anything() }),
        })
      );
    });
  });
});
