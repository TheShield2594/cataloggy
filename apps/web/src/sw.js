import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import { IMAGE_CDN_HOSTS } from "./image-cdn-hosts.mjs";

precacheAndRoute(self.__WB_MANIFEST);

// Injected at container startup with the live VITE_API_BASE value — must
// never be served from cache, or env var changes won't reach the browser.
registerRoute(({ url }) => url.pathname === "/config.js", new NetworkOnly());

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
    cacheName: "poster-images-v1",
    plugins: [
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
const CACHEABLE_API_PATHS = [
  "watchlist",
  "continue",
  "recent",
  "series/progress",
  "watch/history",
  "watch/stats(/detailed)?",
  "trending",
  "popular",
  "recommendations(/.*)?",
  "lists(/.*)?",
  "meta(/.*)?",
  "calendar",
  "streaming(/.*)?",
];

// Read-only catalog/list/history/stats endpoints, safe to serve stale-while-
// revalidate offline. Anything not listed here (and all non-GET requests) goes
// straight to the network.
const CACHEABLE_API_PATH_RE = new RegExp("^/(" + CACHEABLE_API_PATHS.join("|") + ")$");

// Used until the API base is known — the same endpoint names under any prefix.
// Both documented deployments land on the right answer either way; what it
// can't rule out is some unrelated same-origin fetch whose path happens to end
// in one of these names, which is why it gives way to the exact test above as
// soon as there is a base to compare against.
const CACHEABLE_API_TAIL_RE = new RegExp("(?:^|/)(" + CACHEABLE_API_PATHS.join("|") + ")$");

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
  return CACHEABLE_API_PATH_RE.test(url.href.slice(apiBase.length).split(/[?#]/)[0]);
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
