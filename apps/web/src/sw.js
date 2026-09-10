import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { Queue } from "workbox-background-sync";
import { clientsClaim } from "workbox-core";
import {
  API_CACHE_PATH_ALTERNATION,
  API_CACHE_PATH_RE,
} from "@cataloggy/shared/api-cache-routes";
import { IMAGE_CDN_HOSTS } from "./image-cdn-hosts.mjs";
import { parseSizedTmdbImage, tmdbImageAtWidth, TMDB_SRCSET_WIDTHS } from "./poster-widths";

precacheAndRoute(self.__WB_MANIFEST);

// Drops precaches left behind by older Workbox versions. Without it those sit
// in Cache Storage forever, counting against the origin quota that the poster
// cache below is already the first thing to be purged for.
cleanupOutdatedCaches();

// The first visit of all is *uncontrolled*: a worker installs and activates,
// but the page that installed it keeps loading without one, so nothing that
// visit fetches is cached — no posters, no API responses — until the next load.
// Claiming the page closes that gap.
//
// Safe alongside `registerType: "prompt"` (see UpdatePrompt.tsx), which is the
// usual reason to avoid this: an *update* still waits for the user to accept it,
// because a waiting worker never activates until it is sent SKIP_WAITING below.
// This only affects the install that has no predecessor to displace.
clientsClaim();

// Injected at container startup with the live VITE_API_BASE value — must
// never be served from cache, or env var changes won't reach the browser.
registerRoute(({ url }) => url.pathname === "/config.js", new NetworkOnly());

const POSTER_CACHE_NAME = "poster-images-v1";

/**
 * How much larger than the width it asked for a cached poster may be and still
 * be worth serving, as a multiple of that width.
 *
 * The problem this solves: `Poster.tsx` offers six TMDB widths, and one title
 * really is requested at several of them — a 28px history thumbnail, a 192px
 * dashboard card and a 304px shelf hero are three different pictures as far as
 * a URL-keyed cache is concerned. `maxEntries: 400` counts URLs, so the number
 * of *titles* that survive offline is a fraction of what that number reads.
 *
 * The obvious fix — collapse every width to one canonical URL — is worse than
 * the problem. Whichever width happened to be fetched first would then answer
 * for all of them: cache the thumbnail first and the shelf hero is a 92px image
 * blown up to 304, cache the hero first and every thumbnail row downloads 90 KB
 * to draw 28 pixels. That is the whole point of the srcset undone.
 *
 * So the key is shared only in the direction that cannot go wrong: a request
 * may be answered by a *wider* variant that is already cached, never a narrower
 * one, and only up to this ratio — beyond it the decode cost of a poster in a
 * thumbnail slot outweighs the entry saved. A width with nothing suitable
 * cached is fetched and stored under its own URL, exactly as before.
 */
const MAX_POSTER_REUSE_RATIO = 2;

const sharedPosterKeyPlugin = {
  cacheKeyWillBeUsed: async ({ request, mode }) => {
    // Writes always go under the width that was actually fetched — storing a
    // w92 response under a w342 key is the downgrade this exists to avoid.
    if (mode !== "read") return request.url;

    const image = parseSizedTmdbImage(request.url);
    if (!image) return request.url;

    const cache = await caches.open(POSTER_CACHE_NAME);
    // Ascending, so the narrowest variant that will do wins — a 342 slot takes
    // a cached w500 over a cached w780.
    for (const width of TMDB_SRCSET_WIDTHS) {
      if (width <= image.width || width > image.width * MAX_POSTER_REUSE_RATIO) continue;
      const wider = tmdbImageAtWidth(image, width);
      if (await cache.match(wider)) return wider;
    }
    return request.url;
  },
};

// Poster and artwork CDNs. These are content-addressed — a TMDB path names one
// immutable image — so the freshness question never arises and the only reason
// to go to the network is a cache miss. Without this the same posters were
// re-fetched across sessions whenever the browser's own HTTP cache evicted them,
// and never resolved at all offline, leaving the initials-on-a-gradient
// placeholder in place of a library the user has already looked at.
//
// Handling these here moves the request from `img-src` to `connect-src` — see
// the note in image-cdn-hosts.mjs, which is why that list is shared with the
// CSP builder rather than written out again here. Both directives name these
// hosts, since a poster loads by either path depending on whether this worker
// is running.
registerRoute(
  ({ url, request }) => request.destination === "image" && IMAGE_CDN_HOSTS.has(url.hostname),
  new CacheFirst({
    cacheName: POSTER_CACHE_NAME,
    plugins: [
      sharedPosterKeyPlugin,
      // These are loaded by plain <img> tags, so the responses are opaque and
      // report status 0 — the default `[200]` alone would cache nothing.
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 400,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        // Opaque responses are stored padded, so this cache counts against the
        // origin's quota far more heavily than its real size suggests. Let it be
        // the thing that gets dropped when the quota is hit, rather than taking
        // the precache or the API cache down with it.
        purgeOnQuotaError: true,
      }),
    ],
  }),
  "GET"
);

// ─── Where the API lives ───
//
// This test used to be anchored at the root ("^/watchlist$" and friends), which
// matches nothing in the only HTTPS deployment the README documents: Nginx
// Proxy Manager forwards /api/ to the API container, so the paths the app
// requests are /api/watchlist, /api/watch/history and so on. The entire API
// cache — and with it every offline read, the profile-partitioned cache key and
// the INVALIDATE_API_CACHE message — was dead code there.
//
// The base can't be compiled in. It is a runtime value: config.js, written when
// the web container starts, which a browser can further override per-device in
// Settings. So the worker learns it — from the page, the only place that
// override exists, and from config.js at install, for the first load before any
// page has had the chance to say. Cache Storage carries it across the stops and
// starts a service worker's lifetime is made of.

// ─── Which of its endpoints are cacheable ───
//
// Read-only catalog/list/history/stats endpoints, safe to serve stale-while-
// revalidate offline. Anything not on the list (and all non-GET requests) goes
// straight to the network.
//
// The list is the API's own, imported rather than restated: the same table
// decides which `Cache-Control` the API sends for each of these routes. Kept
// here by hand it had drifted both ways — it caught `meta/.../bundle` and the
// personal recommendation feeds through blanket `(/.*)?` prefixes, and had
// never heard of `collection`, `games`, `tags` or `anime`, so four sets of
// read-only routes the API declares cacheable did not work offline.
//
// This worker ignores the tier and caches every route in the table. The tier
// exists to keep per-profile, mutable answers out of the *browser's* HTTP
// cache, which nothing here can reach into to invalidate; this cache is dropped
// whole on any mutation and on a profile switch (INVALIDATE_API_CACHE below),
// so it is not exposed to that hazard.

// Used until the API base is known — the same endpoint names under any prefix.
// Both documented deployments land on the right answer either way; what it
// can't rule out is some unrelated same-origin fetch whose path happens to end
// in one of these names, which is why `isCacheableApiUrl` gives way to the exact
// test as soon as there is a base to compare against.
const CACHEABLE_API_TAIL_RE = new RegExp("(?:^|/)(?:" + API_CACHE_PATH_ALTERNATION + ")$");

const CONFIG_CACHE_NAME = "sw-config-v1";
const API_BASE_CACHE_KEY = "/__cataloggy-sw/api-base";

/** Absolute origin + path prefix of the API, no trailing slash. Null until known. */
let apiBase = null;

const normalizeApiBase = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    // Resolved against this origin so a relative base ("/api", which is what the
    // documented proxy setup produces) compares like an absolute one.
    return new URL(value.trim(), self.location.origin).href.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

const rememberApiBase = async (value) => {
  const normalized = normalizeApiBase(value);
  if (!normalized || normalized === apiBase) return;
  apiBase = normalized;
  try {
    const cache = await caches.open(CONFIG_CACHE_NAME);
    await cache.put(API_BASE_CACHE_KEY, new Response(normalized));
  } catch {
    // Cache Storage unavailable — the base still holds for this worker's
    // lifetime, and is re-learned from the page or config.js after a restart.
  }
};

// config.js is generated by the web container's entrypoint and is a couple of
// assignments of JSON string literals, so this reads the value rather than
// executing anything (a service worker has no eval, and wouldn't want one here).
const readApiBaseFromConfigJs = async () => {
  const response = await fetch("/config.js", { cache: "no-store" });
  if (!response.ok) return null;
  const source = await response.text();
  const match = source.match(/__CATALOGGY_API_BASE__\s*=\s*("(?:[^"\\]|\\.)*")/);
  return match ? JSON.parse(match[1]) : null;
};

const apiBaseReady = (async () => {
  try {
    const cache = await caches.open(CONFIG_CACHE_NAME);
    const stored = await cache.match(API_BASE_CACHE_KEY);
    if (stored) apiBase = normalizeApiBase(await stored.text());
    if (!apiBase) await rememberApiBase(await readApiBaseFromConfigJs());
  } catch {
    // Nothing learned: the tail match above covers both documented deployments
    // until the page sends SET_API_BASE.
  }
})();

self.addEventListener("install", (event) => event.waitUntil(apiBaseReady));

const isCacheableApiUrl = (url) => {
  if (!apiBase) return CACHEABLE_API_TAIL_RE.test(url.pathname);
  if (!url.href.startsWith(apiBase)) return false;
  return API_CACHE_PATH_RE.test(url.href.slice(apiBase.length).split(/[?#]/)[0]);
};

// A same-origin API sits under a path on this origin, so opening one of its URLs
// in a tab is a navigation the shell must not answer — a self-hoster checking
// /api/health through their proxy should get the API's reply, not the app.
const isApiNavigation = (url) =>
  Boolean(apiBase) && url.href.startsWith(apiBase) && url.href.slice(apiBase.length).startsWith("/");

// Kept in sync with API_CACHE_NAME in api.ts, which deletes this cache
// directly on sign-out — the page can't count on a controlling service worker
// being there to take the INVALIDATE_API_CACHE message below.
const API_CACHE_NAME = "api-runtime-v1";

// Two profiles (or two accounts) sharing this app must never see each
// other's cached responses. Workbox's default cache key is just the
// request URL, which carries no auth/profile info — fold the profile id and
// a digest of the auth token into the key so each identity gets its own
// cache partition.
async function digest(text) {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const scopedCacheKeyPlugin = {
  cacheKeyWillBeUsed: async ({ request }) => {
    const url = new URL(request.url);
    const profileId = request.headers.get("x-profile-id") || "none";
    const authHash = await digest(request.headers.get("Authorization") || "");
    url.searchParams.set("__profile", profileId);
    url.searchParams.set("__auth", authHash.slice(0, 16));
    return url.toString();
  },
};

registerRoute(
  ({ url, request }) =>
    request.method === "GET" &&
    // Same-origin deployments can put the API under a path that collides
    // with a frontend route (e.g. "/lists" is both an API endpoint and a
    // React Router route) — only match actual fetch/XHR calls, never page
    // navigations, or we'd cache HTML as if it were JSON.
    request.mode !== "navigate" &&
    request.destination === "" &&
    isCacheableApiUrl(url),
  new StaleWhileRevalidate({
    cacheName: API_CACHE_NAME,
    plugins: [
      scopedCacheKeyPlugin,
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 24 * 60 * 60 }),
    ],
  }),
  "GET"
);

// ─── Writes made with no network ───
//
// Reads survive an outage; writes did not. "Mark watched" on a phone in a
// basement is the single most likely offline action this app has, and it was
// the one thing that could not be done — `api.ts` failed it honestly rather
// than faking an optimistic update, which was the right call with nothing to
// hold the write, but it left the offline story read-only.
//
// So the watch writes are held in IndexedDB and replayed. Only those: a queue
// is a promise to finish something later, and it is only worth making for a
// write whose meaning does not decay. Logging a watch is a fact about something
// that already happened, so it is as true an hour later; renaming a list or
// changing a setting is a request about the present, where a silent replay long
// after the fact is a surprise rather than a service.
//
// Three ways the queue drains, because Background Sync alone is Chromium-only:
//
//  - a `sync` event, which is the only one that fires with the app closed;
//  - REPLAY_QUEUED_WRITES, sent by the page when the connection comes back
//    (see `replayQueuedWrites` in api.ts) — this is what carries iOS;
//  - and, where `sync` is missing, Workbox's own fallback of replaying once at
//    worker startup.
const WRITE_QUEUE_NAME = "cataloggy-offline-writes";

// Relative to the API base, so `/watch` is the log-a-watch endpoint and not a
// React Router path that happens to read like it.
const QUEUEABLE_WRITE_PATH_RE =
  /^\/(?:watch|series\/[^/]+\/season\/\d+\/(?:episode\/\d+\/watch|watch-all))$/;

// Unlike the read cache, this has no tail-matching fallback for a base that
// isn't known yet: guessing wrong about a read costs a stale response, guessing
// wrong about a write means holding someone else's POST and replaying it into
// an endpoint we were never sure of. Unknown base, no queue — the request goes
// to the network and fails the way it always did.
const isQueueableWriteUrl = (url) =>
  Boolean(apiBase) &&
  url.href.startsWith(apiBase) &&
  QUEUEABLE_WRITE_PATH_RE.test(url.href.slice(apiBase.length).split(/[?#]/)[0]);

/** Tells every open tab what happened, so it can refetch and say so. */
const tellClients = async (message) => {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
};

/**
 * Replays the queue, oldest first.
 *
 * Deliberately does not rethrow the way workbox's own `replayRequests` does.
 * The rethrow exists so a `sync` event is retried, but `unshiftRequest` has
 * already re-registered one by the time we would throw — and on a browser
 * without Background Sync workbox calls this at worker startup as `void
 * onSync(...)`, where a rejection is unhandled and lands in the console of
 * every iPhone that opens the app offline.
 *
 * A response the server *rejected* is a different thing from a network that
 * isn't there: the request reached the API and the API said no, and re-sending
 * it on every future sync would never produce a different answer. Those are
 * dropped and counted, so the page can tell the user rather than losing it in
 * silence.
 *
 * `RETRYABLE_STATUSES` is the other case — "not now" rather than "no" — and it
 * matters most for the one this drain earns on its own: a reconnect sends the
 * whole queue as a burst, the API is globally rate-limited (200 requests a
 * minute per IP, `index.ts`), and a 429 landing on the twentieth write must not
 * delete a watch the user was told was saved. Kept as a list rather than
 * `>= 500` for the same reason `lib/http.ts` does: 408 and 425 are the peer
 * asking us to come back, which no status-class test catches.
 */
/**
 * Statuses that mean "ask again later" rather than "no".
 *
 * The same set `apps/api/src/lib/http.ts` retries on, restated rather than
 * shared because the two are not one table: that one governs the API's own
 * outbound calls to TMDB and Trakt, this one governs replaying a write back
 * into the API. They agree today because HTTP says what these codes mean, not
 * because one is derived from the other.
 */
const RETRYABLE_REPLAY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * The drain currently in flight, if any.
 *
 * Both the `sync` event and the page's REPLAY_QUEUED_WRITES message can arrive
 * while a drain is already running — and on a browser with no Background Sync,
 * workbox's startup replay is a third caller. Two drains interleaving their
 * `shiftRequest`/`unshiftRequest` pairs is how a queue that exists to preserve
 * order stops preserving it, so a second caller joins the first instead.
 */
let drainInFlight = null;

const replayQueuedWrites = ({ queue }) => {
  if (drainInFlight) return drainInFlight;
  drainInFlight = drainQueuedWrites({ queue }).finally(() => {
    drainInFlight = null;
  });
  return drainInFlight;
};

const drainQueuedWrites = async ({ queue }) => {
  let replayed = 0;
  let rejected = 0;

  for (let entry = await queue.shiftRequest(); entry; entry = await queue.shiftRequest()) {
    let response;
    try {
      response = await fetch(entry.request.clone());
    } catch {
      // Still no network. Put it back — that re-registers the sync — and stop:
      // the queue is ordered, and a later write may depend on an earlier one.
      await queue.unshiftRequest(entry);
      break;
    }
    if (response.ok) {
      replayed += 1;
    } else if (RETRYABLE_REPLAY_STATUSES.has(response.status)) {
      // The API is reachable and saying "not now". Nothing about this write is
      // wrong, so treat it like the outage above: put it back and stop, which
      // also stops the burst that earned a 429 in the first place.
      await queue.unshiftRequest(entry);
      break;
    } else {
      rejected += 1;
    }
  }

  if (replayed || rejected) {
    // These writes changed rows the read cache is holding stale copies of.
    await caches.delete(API_CACHE_NAME);
    await tellClients({ type: "QUEUED_WRITES_REPLAYED", replayed, rejected });
  }
};

const writeQueue = new Queue(WRITE_QUEUE_NAME, {
  onSync: replayQueuedWrites,
  // A watch logged over a week ago and never sent is not worth replaying into a
  // history the user has long since corrected by hand. This is workbox's own
  // default, written down because it is a product decision, not a detail.
  maxRetentionTime: 7 * 24 * 60,
});

registerRoute(
  ({ url, request }) => request.method === "POST" && isQueueableWriteUrl(url),
  async ({ request }) => {
    try {
      // Cloned because the original has to survive with its body intact: it is
      // what goes into the queue if this throws.
      return await fetch(request.clone());
    } catch {
      await writeQueue.pushRequest({ request });
      // 202, not a rethrown failure. The page needs to tell "held, and it will
      // be sent" apart from "gone" — see `OfflineWriteQueuedError` in api.ts —
      // and only this worker knows which of the two just happened.
      return new Response(JSON.stringify({ queued: true }), {
        status: 202,
        headers: { "Content-Type": "application/json", "X-Cataloggy-Queued": "1" },
      });
    }
  },
  "POST"
);

// ─── App shell ───
//
// precacheAndRoute's directoryIndex covers "/", so a home-screen launch already
// worked offline — but every other entry point (/lists, /search, /calendar, a
// pull-to-refresh on /history) went to the network and got the browser's "no
// internet" page instead of the app. `strategies: "injectManifest"` means
// vite-plugin-pwa generates no navigateFallback of its own; that is a
// generateSW-only feature, so the route is registered here.
registerRoute(
  ({ request, url }) => request.mode === "navigate" && !isApiNavigation(url),
  createHandlerBoundToURL("/index.html")
);

// The page tells us to drop the whole runtime cache when the active profile
// changes, or right after a mutating (POST/PUT/PATCH/DELETE) request
// succeeds — simplest way to avoid serving another profile's or
// now-stale data, at the cost of a few extra refetches.
self.addEventListener("message", (event) => {
  // Sent on every load and whenever the per-device API base override changes:
  // the page is the only place that override exists, so without this the worker
  // would keep matching against the container's compiled-in base.
  if (event.data?.type === "SET_API_BASE") {
    event.waitUntil(rememberApiBase(event.data.apiBase));
    return;
  }

  if (event.data?.type === "INVALIDATE_API_CACHE") {
    const done = caches.delete(API_CACHE_NAME);
    event.waitUntil(done);
    // Ack on the reply port (if the caller sent one) so it can await
    // completion instead of firing-and-forgetting the postMessage.
    done.then(() => event.ports[0]?.postMessage({ done: true }));
    return;
  }

  // Sent by the page when the connection comes back. Chromium would fire its
  // own `sync` event, but nothing else will — on iOS this message is the only
  // thing that drains the queue while the app is open.
  if (event.data?.type === "REPLAY_QUEUED_WRITES") {
    event.waitUntil(replayQueuedWrites({ queue: writeQueue }));
    return;
  }

  // Sent by the page's update-available prompt (see UpdatePrompt.tsx) once
  // the user chooses to reload — without this, a waiting SW never activates
  // and the "Reload" button would appear to do nothing.
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "Cataloggy", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
