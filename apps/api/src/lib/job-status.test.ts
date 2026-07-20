import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

describe("job-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recordJobFailure upserts a KV row keyed by job name with the error message", async () => {
    const { recordJobFailure } = await import("./job-status.js");
    await recordJobFailure("steam-sync", new Error("Steam API unreachable"));

    expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "job-status:steam-sync" },
        create: expect.objectContaining({ key: "job-status:steam-sync", value: "Steam API unreachable" }),
        update: expect.objectContaining({ value: "Steam API unreachable" }),
      })
    );
  });

  it("recordJobFailure stringifies non-Error values and truncates long messages", async () => {
    const { recordJobFailure } = await import("./job-status.js");
    await recordJobFailure("ai-recommendations", "a".repeat(3000));

    const call = prismaMock.kV.upsert.mock.calls[0][0];
    expect(call.create.value.length).toBe(2000);
    expect(call.create.value).toBe("a".repeat(2000));
  });

  it("recordJobSuccess deletes the KV row for that job", async () => {
    const { recordJobSuccess } = await import("./job-status.js");
    await recordJobSuccess("trakt-history-poll");

    expect(prismaMock.kV.deleteMany).toHaveBeenCalledWith({ where: { key: "job-status:trakt-history-poll" } });
  });

  it("getFailedJobStatuses strips the KV key prefix back to the job name", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      { key: "job-status:steam-sync", value: "boom", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const { getFailedJobStatuses } = await import("./job-status.js");
    const result = await getFailedJobStatuses();

    expect(result).toEqual([
      { job: "steam-sync", message: "boom", failedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(prismaMock.kV.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { startsWith: "job-status:" } } })
    );
  });

  it("getFailedJobStatuses returns an empty array when nothing has failed", async () => {
    prismaMock.kV.findMany.mockResolvedValue([]);

    const { getFailedJobStatuses } = await import("./job-status.js");
    const result = await getFailedJobStatuses();

    expect(result).toEqual([]);
  });
});
