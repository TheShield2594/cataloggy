import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithPolicy } from "./http.js";

/** Distinct hostnames per test, so one test's gate never meets another's. */
let hostCounter = 0;
const nextUrl = (path = "/thing") => `https://host-${++hostCounter}.example.com${path}`;

const ok = (body = "{}") => new Response(body, { status: 200 });

describe("fetchWithPolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Drives fake timers while a policy-wrapped request runs. The rejection
   * handler goes on straight away so a request that is *meant* to fail isn't
   * reported as an unhandled rejection while the timers are being advanced.
   */
  const run = <T>(promise: Promise<T>): Promise<T> => {
    promise.catch(() => {});
    return vi.runAllTimersAsync().then(() => promise);
  };

  /** Lets pending microtasks — a released slot, a resolved fetch — settle. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  describe("retrying", () => {
    it("returns a successful response without retrying", async () => {
      const fetchMock = vi.fn(async () => ok('{"ok":true}'));
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl()));

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries a 429 and returns the response that finally succeeded", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls += 1;
          return calls < 3 ? new Response("slow down", { status: 429 }) : ok('{"done":true}');
        })
      );

      const response = await run(fetchWithPolicy(nextUrl()));

      expect(calls).toBe(3);
      expect(await response.json()).toEqual({ done: true });
    });

    it("retries a network error and gives up with the last one", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error("socket hang up");
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(run(fetchWithPolicy(nextUrl(), {}, { retries: 2 }))).rejects.toThrow("socket hang up");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("hands back the failing response when the retries run out", async () => {
      const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl(), {}, { retries: 1 }));

      expect(response.status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry a status that means the request itself was wrong", async () => {
      const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl()));

      expect(response.status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry a POST by default, since the peer may have processed it", async () => {
      const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl(), { method: "POST", body: "{}" }));

      expect(response.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retries a POST when the caller says the call is a read", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls += 1;
          return calls < 2 ? new Response("slow down", { status: 429 }) : ok();
        })
      );

      const response = await run(
        fetchWithPolicy(nextUrl(), { method: "POST", body: "{}" }, { retryMethods: ["POST"] })
      );

      expect(calls).toBe(2);
      expect(response.status).toBe(200);
    });

    it("retries nothing when retries are disabled", async () => {
      const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl(), {}, { retries: 0 }));

      expect(response.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Retry-After", () => {
    it("waits the number of seconds the server asked for", async () => {
      const delays: number[] = [];
      let lastCallAt = 0;
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          const now = Date.now();
          if (calls > 0) delays.push(now - lastCallAt);
          lastCallAt = now;
          calls += 1;
          return calls < 2
            ? new Response("slow down", { status: 429, headers: { "retry-after": "3" } })
            : ok();
        })
      );

      await run(fetchWithPolicy(nextUrl(), {}, { maxDelayMs: 10_000 }));

      expect(calls).toBe(2);
      expect(delays[0]).toBeGreaterThanOrEqual(3_000);
    });

    it("gives up rather than sitting on a wait longer than the policy allows", async () => {
      const fetchMock = vi.fn(
        async () => new Response("slow down", { status: 429, headers: { "retry-after": "600" } })
      );
      vi.stubGlobal("fetch", fetchMock);

      const response = await run(fetchWithPolicy(nextUrl(), {}, { maxDelayMs: 5_000 }));

      expect(response.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("accepts an HTTP date as well as a number of seconds", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls += 1;
          return calls < 2
            ? new Response("slow down", {
                status: 429,
                headers: { "retry-after": new Date(Date.now() + 2_000).toUTCString() },
              })
            : ok();
        })
      );

      const response = await run(fetchWithPolicy(nextUrl(), {}, { maxDelayMs: 10_000 }));

      expect(calls).toBe(2);
      expect(response.status).toBe(200);
    });
  });

  describe("per-host concurrency", () => {
    it("keeps no more than the cap in flight at once for one host", async () => {
      let inFlight = 0;
      let peak = 0;
      const pending: (() => void)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve) => pending.push(resolve));
          inFlight -= 1;
          return ok();
        })
      );

      const url = nextUrl();
      const requests = Promise.all(
        Array.from({ length: 10 }, () => fetchWithPolicy(url, {}, { concurrency: 3 }))
      );

      await flush();
      expect(peak).toBe(3);

      // Finish them one at a time. Each one that finishes hands its slot to a
      // queued request, so ten complete without the cap ever being exceeded.
      for (let done = 0; done < 10; done++) {
        const next = pending.shift();
        expect(next).toBeDefined();
        next?.();
        await flush();
      }

      await expect(requests).resolves.toHaveLength(10);
      expect(peak).toBe(3);
    });

    it("does not let one host's queue hold up another", async () => {
      const started: string[] = [];
      const pending: (() => void)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: URL) => {
          started.push(input.hostname);
          await new Promise<void>((resolve) => pending.push(resolve));
          return ok();
        })
      );

      const busy = nextUrl();
      const other = nextUrl();
      const requests = Promise.all([
        fetchWithPolicy(busy, {}, { concurrency: 1 }),
        fetchWithPolicy(busy, {}, { concurrency: 1 }),
        fetchWithPolicy(other, {}, { concurrency: 1 }),
      ]);

      await flush();
      // The second request to the busy host is queued; the other host's is not.
      expect(new Set(started)).toEqual(new Set([new URL(busy).hostname, new URL(other).hostname]));
      expect(started).toHaveLength(2);

      for (let done = 0; done < 3; done++) {
        pending.shift()?.();
        await flush();
      }

      await expect(requests).resolves.toHaveLength(3);
    });

    it("releases the slot when a request throws, rather than wedging the host", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls += 1;
          if (calls === 1) throw new Error("socket hang up");
          return ok();
        })
      );

      const url = nextUrl();
      await expect(run(fetchWithPolicy(url, {}, { concurrency: 1, retries: 0 }))).rejects.toThrow(
        "socket hang up"
      );

      const response = await run(fetchWithPolicy(url, {}, { concurrency: 1 }));
      expect(response.status).toBe(200);
    });
  });

  describe("caller abort", () => {
    it("stops rather than retrying when the caller has given up", async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async () => {
        controller.abort(new Error("caller left"));
        throw new Error("The operation was aborted");
      });
      vi.stubGlobal("fetch", fetchMock);

      // The caller's own reason, not the abort the socket reported: it is the
      // one that says why the request ended.
      await expect(
        run(fetchWithPolicy(nextUrl(), { signal: controller.signal }, { retries: 3 }))
      ).rejects.toThrow("caller left");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("opens no socket at all for a caller who has already given up", async () => {
      const fetchMock = vi.fn(async () => ok());
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        run(fetchWithPolicy(nextUrl(), { signal: AbortSignal.abort(new Error("too late")) }))
      ).rejects.toThrow("too late");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("releases a queued request when the caller gives up waiting", async () => {
      const controller = new AbortController();
      const pending: (() => void)[] = [];
      const fetchMock = vi.fn(async () => {
        await new Promise<void>((resolve) => pending.push(resolve));
        return ok();
      });
      vi.stubGlobal("fetch", fetchMock);

      const url = nextUrl();
      const holder = fetchWithPolicy(url, {}, { concurrency: 1 });
      await flush();

      // The second request is queued behind the first, which has not answered.
      const queued = fetchWithPolicy(url, { signal: controller.signal }, { concurrency: 1 });
      const rejection = expect(queued).rejects.toThrow("nobody is waiting");
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      controller.abort(new Error("nobody is waiting"));
      await rejection;

      // The slot the abandoned request was waiting for is still usable.
      pending.shift()?.();
      await expect(holder).resolves.toMatchObject({ status: 200 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("total budget", () => {
    it("gives up on a request that spends its whole budget queued", async () => {
      const pending: (() => void)[] = [];
      const fetchMock = vi.fn(async () => {
        await new Promise<void>((resolve) => pending.push(resolve));
        return ok();
      });
      vi.stubGlobal("fetch", fetchMock);

      // Real timers: the budget rides on `AbortSignal.timeout`, which is not
      // something fake timers drive.
      vi.useRealTimers();
      const url = nextUrl();
      const holder = fetchWithPolicy(url, {}, { concurrency: 1 });
      await flush();

      await expect(fetchWithPolicy(url, {}, { concurrency: 1, budgetMs: 20 })).rejects.toThrow(
        /gave up after 20ms/
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      pending.shift()?.();
      await expect(holder).resolves.toMatchObject({ status: 200 });
    });

    it("does not shorten a retry sequence the rest of the policy allows for", async () => {
      let calls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          calls += 1;
          return calls < 3 ? new Response("slow down", { status: 429 }) : ok();
        })
      );

      // No explicit budget: the default is the worst case of timeouts and
      // backoff, so two retries fit inside it with room to spare.
      const response = await run(fetchWithPolicy(nextUrl(), {}, { retries: 2 }));

      expect(calls).toBe(3);
      expect(response.status).toBe(200);
    });
  });
});
