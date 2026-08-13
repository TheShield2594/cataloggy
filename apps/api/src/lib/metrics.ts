// In-process counters for the `/metrics` route.
//
// Deliberately small: a self-hoster running one container should be able to
// answer "is anything erroring, and what is slow" with `curl`, without standing
// up Prometheus first. So the numbers are plain JSON in the same shape as the
// rest of this API, and they live in this process only — a restart resets them,
// which is why `/metrics` reports how long the process has been up beside them.
//
// Two things are counted: HTTP requests this API served (wired to Fastify's
// `onResponse` hook in index.ts) and the outbound calls it made to TMDB, Trakt,
// Stremio and the rest (wired by `instrumentUpstreamFetch` below). Both are
// keyed by something with bounded cardinality — a route *template*, a hostname —
// because a counter map keyed by a real URL is a memory leak with a crawler
// pointed at it.

/** Where a response's status code falls, kept as a handful of buckets. */
export type StatusClass = "2xx" | "3xx" | "4xx" | "5xx" | "other";

const STATUS_CLASSES: readonly StatusClass[] = ["2xx", "3xx", "4xx", "5xx", "other"];

// Both maps are capped and everything past the cap is folded into one bucket,
// so an unmatched-route flood or a user pointing notifications at a thousand
// hostnames costs a bounded amount of memory rather than growing forever.
const MAX_TRACKED_ROUTES = 200;
const MAX_TRACKED_UPSTREAM_HOSTS = 50;
const OVERFLOW_KEY = "other";

/** Requests that matched no route: one bucket, not one key per probed path. */
const UNMATCHED_ROUTE = "(unmatched)";

type Tally = {
  count: number;
  failures: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

const emptyTally = (): Tally => ({ count: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0 });

const addSample = (tally: Tally, durationMs: number, failed: boolean): void => {
  tally.count += 1;
  if (failed) tally.failures += 1;
  tally.totalDurationMs += durationMs;
  if (durationMs > tally.maxDurationMs) tally.maxDurationMs = durationMs;
};

const tallyFor = (tallies: Map<string, Tally>, key: string, limit: number): Tally => {
  const existing = tallies.get(key);
  if (existing) return existing;

  const boundedKey = tallies.size >= limit ? OVERFLOW_KEY : key;
  const created = tallies.get(boundedKey) ?? emptyTally();
  tallies.set(boundedKey, created);
  return created;
};

const newStatusCounts = (): Record<StatusClass, number> => ({ "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 });

let requestTotal = 0;
let requestsByStatusClass = newStatusCounts();
const requestTallies = new Map<string, Tally>();
const upstreamTallies = new Map<string, Tally>();

export const statusClassOf = (statusCode: number): StatusClass => {
  const bucket = `${Math.floor(statusCode / 100)}xx`;
  return (STATUS_CLASSES as readonly string[]).includes(bucket) ? (bucket as StatusClass) : "other";
};

export type RequestSample = {
  method: string;
  /** The route *template* Fastify matched (`/meta/:type/:id`), not the URL. */
  route: string | undefined;
  statusCode: number;
  durationMs: number;
};

export function recordRequest({ method, route, statusCode, durationMs }: RequestSample): void {
  requestTotal += 1;
  requestsByStatusClass[statusClassOf(statusCode)] += 1;
  // Only 5xx counts as a failure: a 401 from a wrong token or a 404 from a
  // deleted title is the API working, and lumping them in would leave the
  // failure count permanently non-zero on a healthy install.
  const tally = tallyFor(requestTallies, `${method} ${route ?? UNMATCHED_ROUTE}`, MAX_TRACKED_ROUTES);
  addSample(tally, durationMs, statusCode >= 500);
}

/**
 * Records one outbound call. `host` is a hostname and never a full URL: several
 * of these APIs take their key as a query parameter, and a counter map is the
 * last place a credential should end up.
 */
export function recordUpstreamCall(host: string, durationMs: number, ok: boolean): void {
  addSample(tallyFor(upstreamTallies, host, MAX_TRACKED_UPSTREAM_HOSTS), durationMs, !ok);
}

export type TallySnapshot = {
  count: number;
  /** 5xx responses served, or upstream calls that errored or answered non-2xx. */
  failures: number;
  totalDurationMs: number;
  maxDurationMs: number;
  avgDurationMs: number;
};

export type RouteMetric = TallySnapshot & { route: string };
export type UpstreamMetric = TallySnapshot & { host: string };

export type MetricsSnapshot = {
  requests: {
    total: number;
    byStatusClass: Record<StatusClass, number>;
    routes: RouteMetric[];
  };
  upstream: UpstreamMetric[];
};

// Sub-millisecond precision in a number meant to be read by a human adds noise,
// so durations round to a tenth of a millisecond on the way out.
const round = (value: number): number => Math.round(value * 10) / 10;

const snapshotOf = (tally: Tally): TallySnapshot => ({
  count: tally.count,
  failures: tally.failures,
  totalDurationMs: round(tally.totalDurationMs),
  maxDurationMs: round(tally.maxDurationMs),
  avgDurationMs: tally.count === 0 ? 0 : round(tally.totalDurationMs / tally.count),
});

// Busiest first: the top of the list is where a `/metrics` reader looks for the
// route that is both hot and slow.
const byCountDescending = <T extends { count: number }>(a: T, b: T): number => b.count - a.count;

export function metricsSnapshot(): MetricsSnapshot {
  return {
    requests: {
      total: requestTotal,
      byStatusClass: { ...requestsByStatusClass },
      routes: [...requestTallies]
        .map(([route, tally]) => ({ route, ...snapshotOf(tally) }))
        .sort(byCountDescending),
    },
    upstream: [...upstreamTallies]
      .map(([host, tally]) => ({ host, ...snapshotOf(tally) }))
      .sort(byCountDescending),
  };
}

/** Test seam: counters are module state, so each test starts from zero. */
export function resetMetrics(): void {
  requestTotal = 0;
  requestsByStatusClass = newStatusCounts();
  requestTallies.clear();
  upstreamTallies.clear();
}

const hostOf = (input: RequestInfo | URL): string => {
  try {
    if (input instanceof URL) return input.hostname;
    const url = typeof input === "string" ? input : input.url;
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
};

let fetchInstrumented = false;

/**
 * Times every outbound `fetch`.
 *
 * The upstream calls in this service are spread across a dozen modules — TMDB,
 * Trakt, Stremio, IGDB, Steam, AniList, OMDb, the AI provider, notification
 * channels — with no shared client to hook, so wrapping the global once at
 * startup is what makes "which integration is slow today" answerable without
 * threading a timer through all of them.
 *
 * Called from index.ts only, so importing this module for its counters (a test,
 * the `/metrics` route) never patches anything.
 */
export function instrumentUpstreamFetch(): void {
  if (fetchInstrumented) return;
  fetchInstrumented = true;

  const original = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const startedAt = performance.now();
    try {
      const response = await original(input, init);
      // A 4xx/5xx from an upstream is a failure of the call regardless of who
      // is at fault — that is the number worth alerting on when TMDB starts
      // rejecting a rotated key.
      recordUpstreamCall(hostOf(input), performance.now() - startedAt, response.ok);
      return response;
    } catch (error) {
      recordUpstreamCall(hostOf(input), performance.now() - startedAt, false);
      throw error;
    }
  };
}
