import { precacheAndRoute } from "workbox-precaching";
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
// Handling these here takes the request out of `img-src` and puts it under
// `connect-src` — see the note in image-cdn-hosts.mjs, which is why that list
// is shared with the CSP builder rather than written out again here.
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

// Read-only catalog/list/history/stats endpoints, safe to serve stale-while-
// revalidate offline. Matched by pathname only since the API can live on any
// configured host. Anything not listed here (and all non-GET requests) goes
// straight to the network.
const CACHEABLE_API_PATH_RE = new RegExp(
  "^/(" +
    [
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
    ].join("|") +
    ")$"
);

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
    CACHEABLE_API_PATH_RE.test(url.pathname),
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

// The page tells us to drop the whole runtime cache when the active profile
// changes, or right after a mutating (POST/PUT/PATCH/DELETE) request
// succeeds — simplest way to avoid serving another profile's or
// now-stale data, at the cost of a few extra refetches.
self.addEventListener("message", (event) => {
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
