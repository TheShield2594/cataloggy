import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCoalescedForTests, coalesce, inFlightCountForTests } from "./coalesce.js";

afterEach(() => clearCoalescedForTests());

describe("coalesce", () => {
  it("runs the work once for callers that arrive together", async () => {
    const work = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "value";
    });

    // The shape of a cold detail panel: six requests for one title, all missing
    // the cache in the same tick.
    const results = await Promise.all(Array.from({ length: 6 }, () => coalesce("key", work)));

    expect(work).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(6).fill("value"));
  });

  it("keeps separate keys separate", async () => {
    const work = vi.fn(async (value: string) => value);
    const [a, b] = await Promise.all([
      coalesce("a", () => work("a")),
      coalesce("b", () => work("b")),
    ]);
    expect(work).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual(["a", "b"]);
  });

  it("is a stampede guard, not a cache — a later caller runs again", async () => {
    const work = vi.fn(async () => "value");
    await coalesce("key", work);
    await coalesce("key", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("releases the key after a rejection, so one failure doesn't poison it", async () => {
    const failing = vi.fn(async () => {
      throw new Error("upstream down");
    });

    await expect(coalesce("key", failing)).rejects.toThrow("upstream down");
    expect(inFlightCountForTests()).toBe(0);

    await expect(coalesce("key", async () => "recovered")).resolves.toBe("recovered");
  });

  it("gives every joined caller the same rejection, from a single run", async () => {
    const failing = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      throw new Error("upstream down");
    });

    const results = await Promise.allSettled([
      coalesce("key", failing),
      coalesce("key", failing),
    ]);

    // Merging has to hold on the failure path too: a second caller joining a
    // doomed run must not quietly start its own retry against the upstream.
    expect(failing).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    const [first, second] = results as PromiseRejectedResult[];
    expect(first.reason).toBeInstanceOf(Error);
    // The same Error object, not merely an equal one — proof they shared a run.
    expect(first.reason).toBe(second.reason);
  });
});
