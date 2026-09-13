/**
 * Where the API is, who the browser is talking to it as, and the caches that
 * follow from both.
 *
 * Everything here is state the whole client shares rather than a call: the base
 * URLs, the stored token and profile, the scoping that keeps one profile's
 * cached rows unreadable to the next, and the messages that keep the service
 * worker's own cache in step. `api/client.ts` makes the requests; the domain
 * modules describe them.
 */

import { invalidateAll as invalidateMemoryCache, setCacheScope } from "../utils/dataCache";

declare global {
  interface Window {
    __CATALOGGY_API_BASE__?: string | undefined;
    __CATALOGGY_ADDON_BASE__?: string | undefined;
  }
}

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const API_BASE_DEFAULT = stripTrailingSlash(
  window.__CATALOGGY_API_BASE__ || import.meta.env.VITE_API_BASE || "http://localhost:7000"
);
// Base URL of the dedicated apps/addon service (the full-featured Stremio
// addon with meta/subtitles/search/genre support) — distinct from the API
// server above, which only hosts a thinner catalog-only manifest.
const ADDON_BASE_DEFAULT = stripTrailingSlash(
  window.__CATALOGGY_ADDON_BASE__ || import.meta.env.VITE_ADDON_BASE || "http://localhost:7001"
);
const API_BASE_OVERRIDE_KEY = "cataloggy_api_base_override";
const TOKEN_KEY = "cataloggy_token";
const PROFILE_ID_KEY = "cataloggy_profile_id";
const PROFILE_TOKEN_KEY = "cataloggy_profile_token";

// Identity of whoever the in-memory cache's entries belong to. Bumped rather
// than derived from the token itself: the counter is enough to make every old
// key unreachable after a rotation, without putting a credential in a map key.
let identityEpoch = 0;

/**
 * Who the client is acting as right now — the selected profile and the epoch
 * above. Everything keyed by it becomes unreachable the moment either changes,
 * which is what keeps one profile from reading rows fetched for another.
 */
export const currentIdentity = () => `${runtimeConfig.getProfileId()}#${identityEpoch}`;

const applyCacheScope = () => setCacheScope(currentIdentity());

export const runtimeConfig = {
  apiBaseDefault: API_BASE_DEFAULT,
  addonBaseDefault: ADDON_BASE_DEFAULT,
  apiBaseOverrideKey: API_BASE_OVERRIDE_KEY,
  tokenKey: TOKEN_KEY,
  profileIdKey: PROFILE_ID_KEY,
  getApiBaseOverride() {
    return window.localStorage.getItem(API_BASE_OVERRIDE_KEY)?.trim() ?? "";
  },
  setApiBaseOverride(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(API_BASE_OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(API_BASE_OVERRIDE_KEY, trimmed);
    }
    // The service worker decides what to cache by comparing against the API
    // base, and this override lives only here — a worker never told about it
    // would go on matching the base the container was built with.
    void tellServiceWorkerWhereTheApiIs();
  },
  getApiBase() {
    return runtimeConfig.getApiBaseOverride() || API_BASE_DEFAULT;
  },
  getAddonBase() {
    return ADDON_BASE_DEFAULT;
  },
  getToken() {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  },
  setToken(value: string) {
    const trimmed = value.trim();
    // Cached GET responses are partitioned by a digest of the token, so a new
    // token can never *read* the old one's entries — but they stay in Cache
    // Storage, readable by any same-origin script, until they expire a day
    // later. Signing out or rotating the token has to take them with it, so
    // the next person on a shared device inherits nothing.
    if (trimmed !== runtimeConfig.getToken()) {
      identityEpoch += 1;
      void purgeApiCache();
    }

    if (!trimmed) {
      window.localStorage.removeItem(TOKEN_KEY);
      applyCacheScope();
      return;
    }

    window.localStorage.setItem(TOKEN_KEY, trimmed);
    applyCacheScope();
  },
  getProfileId() {
    return window.localStorage.getItem(PROFILE_ID_KEY) ?? "";
  },
  setProfileId(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(PROFILE_ID_KEY);
      applyCacheScope();
      return;
    }

    window.localStorage.setItem(PROFILE_ID_KEY, trimmed);
    // Switching profiles must not let the new one read the old one's rows out
    // of memory, the same way the service-worker cache is partitioned by
    // profile — so the scope changes and the previous entries become
    // unreachable in the same tick the id does.
    applyCacheScope();
  },
  clearProfileId() {
    // Leaving a profile (its access token expired, or it locked) is a sign-out
    // of that profile — its cached responses go with it.
    void purgeApiCache();
    window.localStorage.removeItem(PROFILE_ID_KEY);
    window.localStorage.removeItem(PROFILE_TOKEN_KEY);
    applyCacheScope();
  },
  // Signed capability returned by POST /profiles/:id/verify. Sent as the
  // x-profile-token header so PIN-protected profiles pass the server-side gate.
  getProfileToken() {
    return window.localStorage.getItem(PROFILE_TOKEN_KEY) ?? "";
  },
  setProfileToken(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      window.localStorage.removeItem(PROFILE_TOKEN_KEY);
      return;
    }

    window.localStorage.setItem(PROFILE_TOKEN_KEY, trimmed);
  },
  clearProfileToken() {
    window.localStorage.removeItem(PROFILE_TOKEN_KEY);
  }
};

/*
 * The cache scope starts at the identity already in storage, rather than at "".
 *
 * `setCacheScope` only ever ran from a *write* — setToken, setProfileId — so on
 * a plain reload, with a token and a profile id already stored, every cached
 * entry was written under the empty scope until something happened to move it.
 * That something was the shell's own profile fetch: it resolves a second in,
 * calls setProfileId with the id that was already there, and the scope steps
 * from "" to "p1#0" — which clears the cache and tells every mounted consumer
 * that the identity behind its value has changed.
 *
 * For a route page that was invisible: they refetch on mount anyway. For the
 * rail, which holds the profile's lists and never remounts, it was the
 * difference between a column of lists and an empty heading. Naming the scope
 * up front makes that first write a no-op — `setCacheScope` returns early on an
 * unchanged value — and leaves the real switches doing exactly what they did.
 */
applyCacheScope();

/** Mirrors `API_CACHE_NAME` in `sw.js` — the runtime cache of GET API responses. */
const API_CACHE_NAME = "api-runtime-v1";

/**
 * Drops every cached API response, whether or not a service worker is around
 * to be asked. `notifyServiceWorkerToInvalidateApiCache` is a no-op when no SW
 * controls the page (first load, a hard reload, an unregistered worker), which
 * is fine for the freshness case it exists for but not for signing out: the
 * previous token's responses have to leave Cache Storage even then. Cache
 * Storage is same-origin, so the page can delete the cache itself.
 */
export async function purgeApiCache(): Promise<void> {
  invalidateMemoryCache();
  await notifyServiceWorkerToInvalidateApiCache();
  try {
    if (typeof caches !== "undefined") await caches.delete(API_CACHE_NAME);
  } catch {
    // Cache Storage is unavailable (private mode in some browsers, non-secure
    // origin) — there is nothing cached to purge in that case either.
  }
}

/**
 * Tells the service worker which origin and path prefix the API answers on, so
 * its runtime cache matches the requests this browser actually makes.
 *
 * Returns without sending anything when there is no active worker to send to —
 * nothing registered, or one still installing. `navigator.serviceWorker.ready`
 * would be the obvious thing to await, but it never settles when nothing is
 * registered: on a browser that supports service workers but has none (a plain
 * http:// LAN deployment, say) every call would leave a promise pending for the
 * life of the page. The install-time read of `config.js` covers the worker's
 * first run either way, and a later call — the override changing, the next page
 * load — reaches it once it is active.
 */
async function postToServiceWorker(message: unknown): Promise<void> {
  if (!navigator.serviceWorker) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = navigator.serviceWorker.controller ?? registration?.active;
    if (!worker) return;
    worker.postMessage(message);
  } catch {
    // Nothing to tell (unsupported, or a non-secure origin where the registration
    // lookup itself throws).
  }
}

export async function tellServiceWorkerWhereTheApiIs(): Promise<void> {
  await postToServiceWorker({ type: "SET_API_BASE", apiBase: runtimeConfig.getApiBase() });
}

/**
 * Asks the worker to send any writes it took while the connection was down.
 *
 * Chromium fires a Background Sync event for this on its own, with the app
 * closed and everything. Nothing else does — Safari has no Background Sync at
 * all — so on iOS this call, made when the browser says the network is back, is
 * what actually drains the queue. Harmless where the sync event also fires:
 * the queue is drained oldest-first under one worker, so the second attempt
 * finds it empty.
 */
export async function replayQueuedWrites(): Promise<void> {
  await postToServiceWorker({ type: "REPLAY_QUEUED_WRITES" });
}

/**
 * Dispatched on `window` when a queued write turned out to be refused.
 *
 * The in-memory cache being dropped is not enough on its own: a component that
 * ticked an episode optimistically holds that tick in its own state, which no
 * cache invalidation reaches. So the surfaces that show watch state listen for
 * this and re-read it from the server — otherwise a write the user was told was
 * saved stays on screen as saved until the panel is closed and reopened, which
 * is the one outcome worse than saying nothing.
 *
 * Same shape as `cataloggy:unauthorized` and `cataloggy:profile-locked` above:
 * a bare window event, because the surfaces that care are scattered and none of
 * them is an ancestor of the others.
 */
export const WATCH_STATE_STALE_EVENT = "cataloggy:watch-state-stale";

/** What the worker reports back once it has drained the queue (see sw.js). */
export type QueuedWritesReplayed = {
  /** Writes the API accepted. */
  replayed: number;
  /** Writes that reached the API and were refused — those are not retried. */
  rejected: number;
};

/**
 * Calls `onReplayed` whenever the worker finishes sending queued writes.
 *
 * The rows those writes changed are rows the app is very likely rendering from
 * its own in-memory cache, so that cache is dropped here rather than in the
 * caller: every subscriber wants it, and forgetting it would leave the user
 * looking at a history that still doesn't have the watch they logged. A refusal
 * additionally raises `WATCH_STATE_STALE_EVENT`, for the optimistic ticks that
 * live in component state where no cache invalidation can reach them. Both are
 * here rather than in the callback for the same reason: nothing that subscribes
 * should be able to forget them.
 *
 * Returns an unsubscribe function.
 */
export function onQueuedWritesReplayed(onReplayed: (summary: QueuedWritesReplayed) => void): () => void {
  const container = navigator.serviceWorker;
  if (!container) return () => {};

  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown | undefined; replayed?: unknown | undefined; rejected?: unknown | undefined } | null;
    if (data?.type !== "QUEUED_WRITES_REPLAYED") return;
    invalidateMemoryCache();
    const summary = {
      replayed: typeof data.replayed === "number" ? data.replayed : 0,
      rejected: typeof data.rejected === "number" ? data.rejected : 0,
    };
    if (summary.rejected > 0) window.dispatchEvent(new Event(WATCH_STATE_STALE_EVENT));
    onReplayed(summary);
  };

  container.addEventListener("message", listener);
  return () => container.removeEventListener("message", listener);
}

/**
 * How long to wait for the worker's ack before giving up on this one.
 *
 * A worker that answers does it in about a millisecond — this is the budget
 * for a busy one, not for one that is never going to reply.
 */
const INVALIDATE_ACK_TIMEOUT_MS = 200;

/**
 * Which workers answer `INVALIDATE_API_CACHE`, keyed by the worker itself.
 *
 * A worker that predates the ack handshake never replies, and the wait below is
 * on the path of every mutation the app makes: with the old one-second budget,
 * a self-hoster who had updated Cataloggy but not yet reloaded paid a full
 * second of spinner on every "Add to list" — after the server had already
 * answered. Once a controller has failed to reply, stop waiting on it. The
 * message is still sent, so the invalidation still happens; there is just
 * nothing to await.
 *
 * Per worker rather than one flag reset on `controllerchange`, because the two
 * are not the same during the 200ms after an update takes over: a timeout armed
 * for the outgoing worker outlives the switch, and it cannot tell whether the
 * flag it is about to write is still describing the worker it was armed for.
 * Reset-on-change loses that race and marks the *new* worker silent — which
 * turns the wait off exactly when the arriving build is the one that can answer
 * it. Keyed on the worker, a late timeout writes a verdict about the worker it
 * belongs to, and nothing else reads it.
 */
const workerAcksInvalidation = new WeakMap<ServiceWorker, boolean>();

export function notifyServiceWorkerToInvalidateApiCache(): Promise<void> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve();

  const channel = new MessageChannel();
  const acked = new Promise<void>((resolve) => {
    channel.port1.onmessage = () => {
      workerAcksInvalidation.set(sw, true);
      resolve();
    };
  });
  sw.postMessage({ type: "INVALIDATE_API_CACHE" }, [channel.port2]);

  // Awaiting the ack is what keeps a refetch issued right after a mutation from
  // being served the response the mutation just invalidated — the runtime cache
  // is stale-while-revalidate, so a read that beats the delete paints stale data
  // and says nothing about it. Worth a millisecond; not worth a second.
  if (workerAcksInvalidation.get(sw) === false) return Promise.resolve();

  return Promise.race([
    acked,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        // Only if nothing is known yet: an ack that arrived while this timeout
        // was pending is the newer answer, and the truthful one.
        if (!workerAcksInvalidation.has(sw)) workerAcksInvalidation.set(sw, false);
        resolve();
      }, INVALIDATE_ACK_TIMEOUT_MS);
    }),
  ]);
}

/**
 * The in-memory cache prefixes a write to `path` can change, or `null` for
 * "no idea — drop everything".
 *
 * Every mutation used to take the second branch. `invalidateAll()` is correct
 * but blunt: rating one episode dropped the lists page's rows, the games
 * library's and the calendar's along with the stats it actually moved, so the
 * next visit to any of them was a full refetch behind a skeleton — precisely
 * the wait `useCachedState` exists to remove.
 *
 * The rules below only claim what the API's own routes make true, and anything
 * unrecognised still falls through to a full drop, so a new endpoint is
 * over-invalidated rather than silently served stale.
 */
export function invalidatedCachePrefixes(path: string): string[] | null {
  // The route, without the query string a few of these carry (`/checkin?log=1`).
  const queryAt = path.search(/[?#]/);
  const route = queryAt === -1 ? path : path.slice(0, queryAt);
  const under = (prefix: string) => route === prefix || route.startsWith(`${prefix}/`);

  // Nothing outside the games library reads a game: the watch stats, the
  // calendar and the dashboard rails are all built from watch events.
  if (under("/games")) return ["games:"];

  // List membership is read by the lists page, by the Shelf (whose grid is the
  // union of every list) and by the detail panel, which fetches on open rather
  // than from this cache. Watch progress, history, stats and the calendar are
  // all independent of it — none of the write paths in `routes/lists.ts` touch
  // a watch row.
  if (under("/lists")) return ["lists:", "shelf:"];

  // A rating shows up in the "top rated" section of the detailed stats, which
  // the stats page and the dashboard each cache under their own key. It is not
  // part of a watch event, a list or the calendar.
  if (under("/ratings")) return ["stats:", "dash:"];

  // The watch domain, and the widest of the three: a watch writes a history
  // row, moves the totals, updates series progress — and the calendar is built
  // from that same progress table, so a first episode of a new series adds a
  // row to it.
  if (
    under("/watch") ||
    under("/checkin") ||
    /^\/series\/[^/]+\/(watch-next|season\/)/.test(route) ||
    /^\/show\/[^/]+\/drop$/.test(route)
  ) {
    return ["dash:", "history:", "stats:", "calendar:"];
  }

  // Settings, keys, integrations and imports. A Trakt import writes thousands
  // of watch rows, a metadata refresh changes every poster, and a language
  // change re-renders titles — these genuinely do mean everything.
  return null;
}
