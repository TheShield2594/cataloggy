/**
 * One outbound HTTP policy for every integration this service talks to.
 *
 * Each client grew its own posture: Steam retried 429/503 with a backoff, IGDB
 * queued behind a rate limiter, and TMDB — the busiest of them by an order of
 * magnitude — had a timeout and nothing else. So a TMDB throttle surfaced to
 * whoever was looking at the app as an empty catalog, while the same throttle
 * from Steam cleared itself.
 *
 * What this adds over a bare `fetch`:
 *
 *   - **A per-attempt timeout**, so a hung connection can't hold a request open
 *     for as long as the peer feels like keeping the socket.
 *   - **Bounded retry with jitter** on the statuses that mean "later, not
 *     never" (429 and the 5xx family) and on network errors. Jittered because a
 *     catalog render fans out, and an un-jittered backoff re-synchronises the
 *     whole fan-out onto the same instant.
 *   - **`Retry-After`**, honoured when the server sends one. A server that asks
 *     for longer than we are prepared to wait gets its response handed straight
 *     back instead — waiting out a minute-long penalty inside a request nobody
 *     is still watching helps no one.
 *   - **A per-host concurrency cap**, which is the part a retry alone cannot
 *     provide: a Stremio home screen refresh is 20 catalogs, each of which
 *     resolves up to 20 external ids, and several hundred simultaneous requests
 *     is what earns the 429 in the first place.
 *
 * `fetch` is called through the global on purpose — `instrumentUpstreamFetch`
 * in `metrics.ts` wraps it at startup, so every call made through here is
 * counted per host without this module knowing anything about metrics.
 */

export type HttpPolicy = {
  /** Ceiling on a single attempt. A retry gets a fresh one. */
  timeoutMs?: number;
  /** Attempts *after* the first. 0 disables retrying. */
  retries?: number;
  /** First backoff step; each subsequent attempt doubles it. */
  baseDelayMs?: number;
  /** Cap on one backoff step, and on how long a `Retry-After` may ask for. */
  maxDelayMs?: number;
  /** How many requests this process keeps in flight to one host at a time. */
  concurrency?: number;
  /**
   * Which methods are worth retrying. The default is the idempotent ones: a
   * retried POST can duplicate a scrobble, a notification or a sync, and a
   * timeout says nothing about whether the peer processed the body. A caller
   * that knows its POST is a read — a GraphQL query, say — can opt in.
   */
  retryMethods?: readonly string[];
};

const DEFAULT_POLICY = {
  timeoutMs: 10_000,
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  concurrency: 6,
  retryMethods: ["GET", "HEAD", "OPTIONS"] as readonly string[],
};

/**
 * Statuses that are worth sending again. 429 and 503 are the explicit ones;
 * 500/502/504 are included because a gateway in front of an API returns them
 * for a blip as readily as for a real fault, and re-asking once costs little.
 * 408 and 425 are the peer telling us to.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

// ─── Per-host concurrency ───

type HostGate = { limit: number; active: number; waiters: (() => void)[] };

/**
 * Live gates only. A gate is dropped once nothing holds or wants a slot, so a
 * self-hoster pointing notifications at a hundred hostnames doesn't leave a
 * hundred entries behind — the map is bounded by concurrent hosts, not by
 * hosts ever seen.
 */
const gates = new Map<string, HostGate>();

/**
 * Takes a slot for `host`, waiting when the host is at its cap. Returns the
 * release function; the caller must call it exactly once.
 *
 * The tightest limit any caller asks for wins, since two modules disagreeing
 * about a host's budget is a mistake in one of them and the safer reading is
 * the smaller number.
 */
const acquire = async (host: string, limit: number): Promise<() => void> => {
  let gate = gates.get(host);
  if (!gate) {
    gate = { limit, active: 0, waiters: [] };
    gates.set(host, gate);
  } else if (limit < gate.limit) {
    gate.limit = limit;
  }

  if (gate.active < gate.limit) {
    gate.active += 1;
  } else {
    // The releasing holder hands its slot over rather than freeing it, so the
    // count never dips between a wake-up and the woken request starting.
    await new Promise<void>((resolve) => gate.waiters.push(resolve));
  }

  let released = false;
  const held = gate;
  return () => {
    if (released) return;
    released = true;
    const next = held.waiters.shift();
    if (next) {
      next();
      return;
    }
    held.active -= 1;
    if (held.active === 0 && held.waiters.length === 0 && gates.get(host) === held) {
      gates.delete(host);
    }
  };
};

// ─── Retry timing ───

/** `Retry-After` is either delta-seconds or an HTTP date; both are in use. */
const parseRetryAfter = (header: string | null): number | null => {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

/**
 * Half the step plus a random half of it: enough spread to break up a fan-out
 * that failed together, without the "wait almost nothing" that full jitter
 * allows on the attempt right after a 429.
 */
const backoffMs = (attempt: number, baseDelayMs: number, maxDelayMs: number): number => {
  const step = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(step / 2 + Math.random() * (step / 2));
};

const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new Error("Aborted", { cause: reason }));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort);
  });

/**
 * A response that is about to be retried still holds its connection until its
 * body is read or cancelled, and error bodies are never read.
 */
const discard = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // A body that failed to cancel is one the socket has already lost.
  }
};

const timeoutSignal = (caller: AbortSignal | null | undefined, timeoutMs: number): AbortSignal => {
  const deadline = AbortSignal.timeout(timeoutMs);
  return caller ? AbortSignal.any([caller, deadline]) : deadline;
};

// ─── The request ───

/**
 * `fetch` under a retry/timeout/concurrency policy.
 *
 * Returns the response even when its status is a failure — including a 429 that
 * outlasted the retries — because every caller here already reports upstream
 * statuses in its own words. Only a network error, a timeout or an abort throws.
 */
export async function fetchWithPolicy(
  url: string | URL,
  init: RequestInit = {},
  policy: HttpPolicy = {}
): Promise<Response> {
  const { timeoutMs, retries, baseDelayMs, maxDelayMs, concurrency, retryMethods } = {
    ...DEFAULT_POLICY,
    ...policy,
  };

  const target = url instanceof URL ? url : new URL(url);
  const method = (init.method ?? "GET").toUpperCase();
  const retryable = retries > 0 && retryMethods.includes(method);
  const callerSignal = init.signal ?? null;

  const release = await acquire(target.hostname, concurrency);
  try {
    let lastError: unknown = null;

    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null;
      try {
        response = await fetch(target, { ...init, signal: timeoutSignal(callerSignal, timeoutMs) });
      } catch (error) {
        // The caller giving up is not a failure to retry around.
        if (callerSignal?.aborted) throw error;
        lastError = error;
      }

      if (response && !(retryable && RETRYABLE_STATUSES.has(response.status))) {
        return response;
      }

      if (!retryable || attempt >= retries) {
        if (response) return response;
        throw lastError instanceof Error
          ? lastError
          : new Error(`Request to ${target.hostname} failed`, { cause: lastError });
      }

      const askedFor = response ? parseRetryAfter(response.headers.get("retry-after")) : null;
      if (askedFor !== null && askedFor > maxDelayMs) return response!;

      if (response) await discard(response);
      await sleep(askedFor ?? backoffMs(attempt, baseDelayMs, maxDelayMs), callerSignal);
    }
  } finally {
    release();
  }
}
