import { beforeEach, describe, expect, it, vi } from "vitest";
import { P2002 } from "./test-fixtures/prisma-errors.js";

const prismaMock = {
  list: { findFirst: vi.fn(), create: vi.fn() },
  profile: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

describe("ensureDefaultCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
  });

  it("does nothing when a collection already exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1" });
    const { ensureDefaultCollection } = await import("./collection.js");

    await ensureDefaultCollection();

    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("creates a collection when none exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockResolvedValue({ id: "list-1" });
    const { ensureDefaultCollection } = await import("./collection.js");

    await ensureDefaultCollection();

    expect(prismaMock.list.create).toHaveBeenCalledWith({
      data: { kind: "collection", name: "Collection", profileId: "profile-1" },
    });
  });

  it("resolves without throwing when a P2002 race retry finds the winner's row", async () => {
    prismaMock.list.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.list.create.mockRejectedValue(P2002);
    const { ensureDefaultCollection } = await import("./collection.js");

    await expect(ensureDefaultCollection()).resolves.toBeUndefined();
  });

  it("rethrows non-P2002 errors", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockRejectedValue(new Error("connection lost"));
    const { ensureDefaultCollection } = await import("./collection.js");

    await expect(ensureDefaultCollection()).rejects.toThrow("connection lost");
  });
});

describe("getDefaultCollection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing collection for the given profile", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1" });
    const { getDefaultCollection } = await import("./collection.js");

    const result = await getDefaultCollection("profile-1");

    expect(result).toEqual({ id: "list-1" });
    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("creates one when none exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockResolvedValue({ id: "list-new" });
    const { getDefaultCollection } = await import("./collection.js");

    const result = await getDefaultCollection("profile-1");

    expect(result).toEqual({ id: "list-new" });
  });

  it("retries the lookup and returns the winner's row on a P2002 race", async () => {
    prismaMock.list.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.list.create.mockRejectedValue(P2002);
    const { getDefaultCollection } = await import("./collection.js");

    const result = await getDefaultCollection("profile-1");

    expect(result).toEqual({ id: "winner" });
    expect(prismaMock.list.findFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows if a P2002 race retry still finds nothing", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockRejectedValue(P2002);
    const { getDefaultCollection } = await import("./collection.js");

    await expect(getDefaultCollection("profile-1")).rejects.toBe(P2002);
  });
});
