import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const storedValue = () => JSON.parse(prismaMock.kV.upsert.mock.calls[0][0].create.value);

describe("job-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recordJobFailure upserts a KV row keyed by job name with the error message", async () => {
    const { recordJobFailure } = await import("./job-status.js");
    await recordJobFailure("steam-sync", new Error("Steam API unreachable"));

    expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "job-status:steam-sync" } })
    );
    expect(storedValue()).toEqual({ status: "failed", message: "Steam API unreachable" });
  });

  it("recordJobFailure stringifies non-Error values and truncates long messages", async () => {
    const { recordJobFailure } = await import("./job-status.js");
    await recordJobFailure("ai-recommendations", "a".repeat(3000));

    expect(storedValue().message).toBe("a".repeat(2000));
  });

  it("recordJobSuccess replaces the job's last outcome", async () => {
    const { recordJobSuccess } = await import("./job-status.js");
    await recordJobSuccess("trakt-history-poll");

    expect(prismaMock.kV.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "job-status:trakt-history-poll" } })
    );
    expect(storedValue()).toEqual({ status: "ok" });
  });

  it("flags a run that outlasted its own interval, which is a tick the scheduler dropped", async () => {
    const { recordJobSuccess } = await import("./job-status.js");
    await recordJobSuccess("trakt-history-poll", { durationMs: 900_000, intervalMs: 300_000 });

    expect(storedValue()).toEqual({ status: "ok", durationMs: 900_000, overran: true });
  });

  it("does not flag a run that finished inside its interval", async () => {
    const { recordJobSuccess } = await import("./job-status.js");
    await recordJobSuccess("scrobble-cleanup", { durationMs: 40, intervalMs: 300_000 });

    expect(storedValue()).toEqual({ status: "ok", durationMs: 40, overran: false });
  });

  it("getJobRuns reports successes and failures alike, with their durations", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      {
        key: "job-status:steam-sync",
        value: JSON.stringify({ status: "failed", message: "boom", durationMs: 12, overran: false }),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        key: "job-status:trakt-history-poll",
        value: JSON.stringify({ status: "ok", durationMs: 900_000, overran: true }),
        updatedAt: new Date("2026-01-01T00:01:00Z"),
      },
    ]);

    const { getJobRuns } = await import("./job-status.js");

    expect(await getJobRuns()).toEqual([
      {
        job: "steam-sync",
        status: "failed",
        message: "boom",
        durationMs: 12,
        overran: false,
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        job: "trakt-history-poll",
        status: "ok",
        message: null,
        durationMs: 900_000,
        overran: true,
        at: "2026-01-01T00:01:00.000Z",
      },
    ]);
  });

  it("still reads a failure written before runs were stored as JSON", async () => {
    // Upgrading shouldn't lose the failure a self-hoster is looking at right now.
    prismaMock.kV.findMany.mockResolvedValue([
      { key: "job-status:steam-sync", value: "Steam API returned 503", updatedAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    const { getFailedJobStatuses } = await import("./job-status.js");

    expect(await getFailedJobStatuses()).toEqual([
      { job: "steam-sync", message: "Steam API returned 503", failedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("getFailedJobStatuses strips the KV key prefix and leaves out healthy jobs", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      {
        key: "job-status:steam-sync",
        value: JSON.stringify({ status: "failed", message: "boom" }),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        key: "job-status:scrobble-cleanup",
        value: JSON.stringify({ status: "ok", durationMs: 3 }),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const { getFailedJobStatuses } = await import("./job-status.js");

    expect(await getFailedJobStatuses()).toEqual([
      { job: "steam-sync", message: "boom", failedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(prismaMock.kV.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: { startsWith: "job-status:" } } })
    );
  });

  it("getFailedJobStatuses returns an empty array when nothing has failed", async () => {
    prismaMock.kV.findMany.mockResolvedValue([]);

    const { getFailedJobStatuses } = await import("./job-status.js");

    expect(await getFailedJobStatuses()).toEqual([]);
  });
});
