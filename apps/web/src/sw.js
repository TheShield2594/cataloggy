import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly, StaleWhileRevalidate } from "workbox-strategies";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";

precacheAndRoute(self.__WB_MANIFEST);

// Injected at container startup with the live VITE_API_BASE value — must
// never be served from cache, or env var changes won't reach the browser.
registerRoute(({ url }) => url.pathname === "/config.js", new NetworkOnly());

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
      "streaming.*",
    ].join("|") +
    ")$"
);

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
  ({ url, request }) => request.method === "GET" && CACHEABLE_API_PATH_RE.test(url.pathname),
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
    event.waitUntil(caches.delete(API_CACHE_NAME));
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
