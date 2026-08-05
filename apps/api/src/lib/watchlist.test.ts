import { beforeEach, describe, expect, it, vi } from "vitest";
import { P2002 } from "./test-fixtures/prisma-errors.js";

const prismaMock = {
  list: { findFirst: vi.fn(), create: vi.fn() },
  profile: { findFirst: vi.fn(), create: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

describe("ensureDefaultWatchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.profile.findFirst.mockResolvedValue({ id: "profile-1" });
  });

  it("does nothing when a watchlist already exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1" });
    const { ensureDefaultWatchlist } = await import("./watchlist.js");

    await ensureDefaultWatchlist();

    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("creates a watchlist when none exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockResolvedValue({ id: "list-1" });
    const { ensureDefaultWatchlist } = await import("./watchlist.js");

    await ensureDefaultWatchlist();

    expect(prismaMock.list.create).toHaveBeenCalledWith({
      data: { kind: "watchlist", name: "Watchlist", profileId: "profile-1" },
    });
  });

  it("finds a renamed watchlist rather than bootstrapping a second one", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1", name: "Up Next" });
    const { ensureDefaultWatchlist } = await import("./watchlist.js");

    await ensureDefaultWatchlist();

    expect(prismaMock.list.findFirst).toHaveBeenCalledWith({
      where: { kind: "watchlist", profileId: "profile-1" },
    });
    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("resolves without throwing when a P2002 race retry finds the winner's row", async () => {
    prismaMock.list.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.list.create.mockRejectedValue(P2002);
    const { ensureDefaultWatchlist } = await import("./watchlist.js");

    await expect(ensureDefaultWatchlist()).resolves.toBeUndefined();
  });
});

describe("getDefaultWatchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing watchlist for the given profile", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1" });
    const { getDefaultWatchlist } = await import("./watchlist.js");

    const result = await getDefaultWatchlist("profile-1");

    expect(result).toEqual({ id: "list-1" });
    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("creates one when none exists", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockResolvedValue({ id: "list-new" });
    const { getDefaultWatchlist } = await import("./watchlist.js");

    const result = await getDefaultWatchlist("profile-1");

    expect(result).toEqual({ id: "list-new" });
  });

  // A rename used to orphan the default watchlist: the lookup asked for a list
  // called "Watchlist" as well as one of kind watchlist, missed the renamed row
  // and created a duplicate beside it.
  it("returns a renamed watchlist instead of creating a duplicate", async () => {
    prismaMock.list.findFirst.mockResolvedValue({ id: "list-1", name: "Up Next" });
    const { getDefaultWatchlist } = await import("./watchlist.js");

    const result = await getDefaultWatchlist("profile-1");

    expect(result).toEqual({ id: "list-1", name: "Up Next" });
    expect(prismaMock.list.findFirst).toHaveBeenCalledWith({
      where: { kind: "watchlist", profileId: "profile-1" },
      orderBy: { createdAt: "asc" },
    });
    expect(prismaMock.list.create).not.toHaveBeenCalled();
  });

  it("retries the lookup and returns the winner's row on a P2002 race instead of throwing", async () => {
    prismaMock.list.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner" });
    prismaMock.list.create.mockRejectedValue(P2002);
    const { getDefaultWatchlist } = await import("./watchlist.js");

    const result = await getDefaultWatchlist("profile-1");

    expect(result).toEqual({ id: "winner" });
    expect(prismaMock.list.findFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows if a P2002 race retry still finds nothing", async () => {
    prismaMock.list.findFirst.mockResolvedValue(null);
    prismaMock.list.create.mockRejectedValue(P2002);
    const { getDefaultWatchlist } = await import("./watchlist.js");

    await expect(getDefaultWatchlist("profile-1")).rejects.toBe(P2002);
  });
});
