import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("./prisma.js", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

const loadCheckDatabase = async () => {
  vi.resetModules();
  return (await import("./db-health.js")).checkDatabase;
};

describe("checkDatabase", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("reports ok with a latency when the query answers", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const checkDatabase = await loadCheckDatabase();

    const result = await checkDatabase();

    expect(result).toMatchObject({ ok: true, error: null });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports the failure when the query rejects", async () => {
    queryRaw.mockRejectedValue(new Error("Can't reach database server at `db:5432`"));
    const checkDatabase = await loadCheckDatabase();

    expect(await checkDatabase()).toMatchObject({
      ok: false,
      error: "Can't reach database server at `db:5432`",
    });
  });

  it("gives up on a query that never answers", async () => {
    // The case the old unconditional /health missed entirely: the pool is
    // exhausted, so the statement is neither refused nor served, and without a
    // deadline the probe waits as long as the requests it is meant to warn
    // about.
    queryRaw.mockReturnValue(new Promise(() => {}));
    const checkDatabase = await loadCheckDatabase();

    expect(await checkDatabase(20)).toMatchObject({
      ok: false,
      error: "Database probe timed out after 20ms",
    });
  });

  it("truncates a long error rather than returning a wall of text", async () => {
    queryRaw.mockRejectedValue(new Error("x".repeat(5000)));
    const checkDatabase = await loadCheckDatabase();

    const result = await checkDatabase();

    expect(result.error).toHaveLength(200);
  });

  it("does not leave its deadline timer holding the event loop open", async () => {
    // A probe runs every ten seconds forever; an uncleared timer per run would
    // keep the process from exiting and pile up along the way.
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const checkDatabase = await loadCheckDatabase();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await checkDatabase();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
