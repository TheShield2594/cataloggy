import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { findMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

describe("getDroppedSeriesIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty set without querying when no ids are given", async () => {
    const { getDroppedSeriesIds } = await import("./dropped-shows.js");
    const result = await getDroppedSeriesIds("profile-1", []);

    expect(result.size).toBe(0);
    expect(prismaMock.kV.findMany).not.toHaveBeenCalled();
  });

  it("maps dropped KV keys back to their imdb ids", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      { key: "dropped:series:profile-1:tt-dropped" },
    ]);

    const { getDroppedSeriesIds } = await import("./dropped-shows.js");
    const result = await getDroppedSeriesIds("profile-1", ["tt-dropped", "tt-watching"]);

    expect(result.has("tt-dropped")).toBe(true);
    expect(result.has("tt-watching")).toBe(false);
    expect(prismaMock.kV.findMany).toHaveBeenCalledWith({
      where: {
        key: {
          in: ["dropped:series:profile-1:tt-dropped", "dropped:series:profile-1:tt-watching"],
        },
      },
      select: { key: true },
    });
  });
});
