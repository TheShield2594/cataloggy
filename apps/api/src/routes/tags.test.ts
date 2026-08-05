import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TAG_ID = "22222222-2222-4222-8222-222222222222";

const prismaMock = {
  tag: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  itemTag: { upsert: vi.fn(), deleteMany: vi.fn() },
};

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../lib/profile.js", () => ({
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = PROFILE_ID;
  },
}));

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: tagsRoutes } = await import("./tags.js");
  const app = Fastify();
  await app.register(tagsRoutes);
  await app.ready();
  return app;
};

const tagRow = (over: Record<string, unknown> = {}) => ({
  id: TAG_ID,
  name: "comfort",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("tags routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /tags", () => {
    it("returns every tag of the profile with its item count", async () => {
      prismaMock.tag.findMany.mockResolvedValue([{ ...tagRow(), _count: { items: 3 } }]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/tags" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { profileId: PROFILE_ID } })
      );
      expect(res.json().tags[0]).toMatchObject({ name: "comfort", itemCount: 3 });
      await app.close();
    });

    it("scopes to one item when type and imdbId are given", async () => {
      prismaMock.tag.findMany.mockResolvedValue([tagRow()]);
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/tags?type=movie&imdbId=tt1" });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { profileId: PROFILE_ID, items: { some: { type: "movie", imdbId: "tt1" } } },
        })
      );
      // The item-scoped shape has no count to report.
      expect(res.json().tags[0]).not.toHaveProperty("itemCount");
      await app.close();
    });

    it("rejects imdbId without a type", async () => {
      // Half a filter would silently widen to every tag on the profile.
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/tags?imdbId=tt1" });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.tag.findMany).not.toHaveBeenCalled();
      await app.close();
    });

    it("rejects a type that is not an item type", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "GET", url: "/tags?type=book&imdbId=tt1" });

      expect(res.statusCode).toBe(400);
      await app.close();
    });
  });

  describe("POST /tags", () => {
    it("returns the existing tag rather than failing on a duplicate name", async () => {
      prismaMock.tag.upsert.mockResolvedValue(tagRow());
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tags", payload: { name: "  comfort  " } });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.tag.upsert).toHaveBeenCalledWith({
        where: { profileId_name: { profileId: PROFILE_ID, name: "comfort" } },
        create: { profileId: PROFILE_ID, name: "comfort" },
        update: {},
      });
      await app.close();
    });

    it("rejects an empty name", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tags", payload: { name: "   " } });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("caps the name at 50 characters", async () => {
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tags", payload: { name: "a".repeat(51) } });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.tag.upsert).not.toHaveBeenCalled();
      await app.close();
    });

    it("accepts a name of exactly 50 characters", async () => {
      prismaMock.tag.upsert.mockResolvedValue(tagRow({ name: "a".repeat(50) }));
      const app = await buildApp();

      const res = await app.inject({ method: "POST", url: "/tags", payload: { name: "a".repeat(50) } });

      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });

  describe("DELETE /tags/:tagId", () => {
    it("only deletes within the calling profile", async () => {
      prismaMock.tag.deleteMany.mockResolvedValue({ count: 1 });
      const app = await buildApp();

      const res = await app.inject({ method: "DELETE", url: `/tags/${TAG_ID}` });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.tag.deleteMany).toHaveBeenCalledWith({
        where: { id: TAG_ID, profileId: PROFILE_ID },
      });
      await app.close();
    });
  });

  describe("POST /tags/assign", () => {
    it("creates the tag by name and links it to the item", async () => {
      prismaMock.tag.upsert.mockResolvedValue(tagRow());
      prismaMock.itemTag.upsert.mockResolvedValue({});
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/tags/assign",
        payload: { tagName: " comfort ", type: "series", imdbId: " tt0903747 " },
      });

      expect(res.statusCode).toBe(200);
      expect(prismaMock.itemTag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tagId_type_imdbId: { tagId: TAG_ID, type: "series", imdbId: "tt0903747" } },
        })
      );
      await app.close();
    });

    it("is idempotent — re-assigning does not error", async () => {
      prismaMock.tag.upsert.mockResolvedValue(tagRow());
      prismaMock.itemTag.upsert.mockResolvedValue({});
      const app = await buildApp();

      const payload = { tagName: "comfort", type: "movie", imdbId: "tt1" };
      const first = await app.inject({ method: "POST", url: "/tags/assign", payload });
      const second = await app.inject({ method: "POST", url: "/tags/assign", payload });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      await app.close();
    });

    it("rejects a missing tagName", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/tags/assign",
        payload: { type: "movie", imdbId: "tt1" },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("rejects an unknown item type", async () => {
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/tags/assign",
        payload: { tagName: "comfort", type: "book", imdbId: "tt1" },
      });

      expect(res.statusCode).toBe(400);
      expect(prismaMock.tag.upsert).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe("DELETE /tags/assign", () => {
    it("unlinks the tag from the item", async () => {
      prismaMock.tag.findFirst.mockResolvedValue(tagRow());
      prismaMock.itemTag.deleteMany.mockResolvedValue({ count: 1 });
      const app = await buildApp();

      const res = await app.inject({
        method: "DELETE",
        url: "/tags/assign",
        payload: { tagId: TAG_ID, type: "movie", imdbId: "tt1" },
      });

      expect(res.statusCode).toBe(204);
      expect(prismaMock.itemTag.deleteMany).toHaveBeenCalledWith({
        where: { tagId: TAG_ID, type: "movie", imdbId: "tt1" },
      });
      await app.close();
    });

    it("404s on a tag owned by another profile", async () => {
      prismaMock.tag.findFirst.mockResolvedValue(null);
      const app = await buildApp();

      const res = await app.inject({
        method: "DELETE",
        url: "/tags/assign",
        payload: { tagId: TAG_ID, type: "movie", imdbId: "tt1" },
      });

      expect(res.statusCode).toBe(404);
      expect(prismaMock.itemTag.deleteMany).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
