/**
 * The service worker had no test file, and two defects that a test would have
 * caught immediately: its cacheable-path matcher was anchored at the root, so
 * it matched nothing in the reverse-proxy deployment the README documents
 * (`/api/watchlist`, not `/watchlist`), and there was no navigation fallback at
 * all, so every route but "/" failed offline.
 *
 * The worker is exercised through the routes it registers: workbox is mocked
 * down to recording what was handed to `registerRoute`, and the match callbacks
 * are then called with the requests a browser would make.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchCallback = (args: { url: URL; request: Partial<Request> }) => unknown;
type RouteHandler = (args: { request: Request }) => Promise<Response>;
type RegisteredRoute = { match: MatchCallback; handler: unknown; method?: string | undefined };

/** A workbox plugin, of which only the one hook these tests exercise matters. */
type CacheKeyPlugin = {
  cacheKeyWillBeUsed: (args: { request: { url: string }; mode: "read" | "write" }) => Promise<string>;
};

const registeredRoutes: RegisteredRoute[] = [];
const messageListeners: ((event: { data?: unknown; waitUntil: (p: Promise<unknown>) => void }) => void)[] = [];

class StrategyStub {
  constructor(public readonly options: { cacheName?: string; plugins?: unknown[] } = {}) {}
}

/** Stands in for the IndexedDB-backed queue workbox-background-sync provides. */
class QueueStub {
  static instances: QueueStub[] = [];
  entries: { request: Request }[] = [];
  constructor(
    public readonly name: string,
    public readonly options: { onSync?: unknown; maxRetentionTime?: number } = {}
  ) {
    QueueStub.instances.push(this);
  }
  async pushRequest(entry: { request: Request }) { this.entries.push(entry); }
  async unshiftRequest(entry: { request: Request }) { this.entries.unshift(entry); }
  async shiftRequest() { return this.entries.shift(); }
}

vi.mock("workbox-routing", () => ({
  registerRoute: (match: MatchCallback, handler: unknown, method?: string) =>
    registeredRoutes.push({ match, handler, method }),
}));

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: (url: string) => ({ precachedShell: url }),
}));

vi.mock("workbox-core", () => ({ clientsClaim: vi.fn() }));

vi.mock("workbox-strategies", () => ({
  CacheFirst: StrategyStub,
  NetworkOnly: StrategyStub,
  StaleWhileRevalidate: StrategyStub,
}));

vi.mock("workbox-cacheable-response", () => ({ CacheableResponsePlugin: StrategyStub }));
vi.mock("workbox-expiration", () => ({ ExpirationPlugin: StrategyStub }));
vi.mock("workbox-background-sync", () => ({ Queue: QueueStub }));

const CONFIG_JS = (apiBase: string) =>
  `window.__CATALOGGY_API_BASE__ = ${JSON.stringify(apiBase)};\nwindow.__CATALOGGY_ADDON_BASE__ = "";\n`;

/**
 * Cache Storage: where the worker keeps the API base across restarts, and where
 * the poster cache lives. Keyed by cache name, because the two are separate
 * caches and the poster key plugin looks in its own.
 */
const caches_ = new Map<string, Map<string, string>>();
const deletedCaches: string[] = [];

const cacheNamed = (name: string) => {
  const existing = caches_.get(name);
  if (existing) return existing;
  const created = new Map<string, string>();
  caches_.set(name, created);
  return created;
};

const stubCacheStorage = () => {
  caches_.clear();
  deletedCaches.length = 0;
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      const entries = cacheNamed(name);
      return {
        match: async (key: string) => (entries.has(key) ? new Response(entries.get(key)) : undefined),
        put: async (key: string, response: Response) => void entries.set(key, await response.text()),
      };
    },
    delete: vi.fn(async (name: string) => {
      deletedCaches.push(name);
      return caches_.delete(name);
    }),
  });
};

/** Loads the worker with `/config.js` answering with the given API base. */
const loadWorker = async (configApiBase: string | null) => {
  registeredRoutes.length = 0;
  messageListeners.length = 0;
  QueueStub.instances.length = 0;
  notifiedClients.length = 0;
  stubCacheStorage();
  vi.stubGlobal("clients", {
    matchAll: async () => [{ postMessage: (message: unknown) => notifiedClients.push(message) }],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      String(input).endsWith("/config.js") && configApiBase !== null
        ? new Response(CONFIG_JS(configApiBase))
        : new Response("", { status: 404 })
    )
  );
  vi.stubGlobal("addEventListener", (type: string, listener: (event: never) => void) => {
    if (type === "message") messageListeners.push(listener as never);
  });

  vi.resetModules();
  // Untyped on purpose: sw.js is worker source, outside the app's module graph.
  // @ts-expect-error -- no declaration file for a plain-JS service worker
  await import("./sw.js");
  // The base is read asynchronously at startup (the install event is what waits
  // on it in a real worker). Until it lands, the tail fallback matches this URL;
  // once it has, nothing off the API's own host does.
  if (configApiBase !== null) {
    await vi.waitFor(() => expect(apiRoute()(apiRequest("https://not-the-api.example/watchlist"))).toBeFalsy());
  }
};

/** Messages the worker posted to open tabs. */
const notifiedClients: unknown[] = [];

/** Delivers a message to the worker and waits for whatever it kept hold of. */
const sendToWorker = async (data: unknown) => {
  const waits: Promise<unknown>[] = [];
  for (const listener of messageListeners) {
    listener({ data, waitUntil: (p) => waits.push(p) });
  }
  await Promise.all(waits);
};

const apiRoute = (): MatchCallback => {
  const route = registeredRoutes.find(
    (r) => r.handler instanceof StrategyStub && r.handler.options.cacheName === "api-runtime-v1"
  );
  if (!route) throw new Error("no API cache route registered");
  return route.match;
};

/** A fetch/XHR the app makes for JSON — not a page navigation, not an image. */
const apiRequest = (href: string) => ({
  url: new URL(href),
  request: { method: "GET", mode: "cors" as RequestMode, destination: "" as RequestDestination },
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("API response caching", () => {
  it("caches the endpoints served under the reverse proxy's /api/ prefix", async () => {
    // README's documented HTTPS deployment: Nginx Proxy Manager forwards /api/
    // to the API container. The root-anchored matcher this replaces matched
    // none of these, leaving the whole cache — and every offline read — dead.
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/watchlist"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/watch/history"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/lists/abc/items"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/watch/stats/detailed"))).toBeTruthy();
  });

  it("caches the same endpoints when the API is mounted at the root of its own host", async () => {
    await loadWorker("http://192.168.1.25:7000");
    const matches = apiRoute();

    expect(matches(apiRequest("http://192.168.1.25:7000/watchlist"))).toBeTruthy();
    expect(matches(apiRequest("http://192.168.1.25:7000/series/progress"))).toBeTruthy();
  });

  it("caches nothing from another host, whatever the path looks like", async () => {
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://somewhere.else/api/watchlist"))).toBeFalsy();
    // A path that merely starts with the same characters is not under the base.
    expect(matches(apiRequest("https://cataloggy.example/apifoo/watchlist"))).toBeFalsy();
  });

  it("caches every read-only route the API declares cacheable, not a subset of them", async () => {
    // The worker's list used to be maintained by hand alongside the API's, and
    // had never been told about these four — so `collection`, the games
    // library, tags and the anime catalog were all read-only routes the API
    // tiers for caching that nonetheless did nothing offline. Both sides now
    // read one table (@cataloggy/shared/api-cache-routes).
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/collection"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/games"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/tags"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/anime"))).toBeTruthy();
  });

  it("caches the per-profile routes the API keeps out of the browser's own cache", async () => {
    // These are deliberately *not* in the API's long-lived `metadata` tier: the
    // bundle carries the profile's dropped flag and the two recommendation
    // feeds come from its watch history, and nothing in the app can reach into
    // the browser's HTTP cache to invalidate them. This cache is different —
    // INVALIDATE_API_CACHE drops it whole on any mutation and on a profile
    // switch — so caching them here is safe, and is what makes them readable
    // offline.
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/meta/movie/tt1/bundle"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/recommendations/personal"))).toBeTruthy();
    expect(matches(apiRequest("https://cataloggy.example/api/recommendations/ai"))).toBeTruthy();
  });

  it("does not cache a maintenance route that merely reads like a cacheable one", async () => {
    // `/metadata/*` rebuilds the metadata cache; `/meta/*` reads it.
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/metadata/sync"))).toBeFalsy();
    expect(matches(apiRequest("https://cataloggy.example/api/metadata/anime-search?q=bebop"))).toBeFalsy();
  });

  it("leaves write endpoints and anything unlisted to the network", async () => {
    await loadWorker("https://cataloggy.example/api");
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/search?q=dune"))).toBeFalsy();
    expect(matches(apiRequest("https://cataloggy.example/api/settings/job-status"))).toBeFalsy();
  });

  it("falls back to matching the path tail before the API base is known", async () => {
    // No config.js (the dev server, or a first load that raced the install).
    await loadWorker(null);
    const matches = apiRoute();

    expect(matches(apiRequest("https://cataloggy.example/api/watchlist"))).toBeTruthy();
    expect(matches(apiRequest("http://192.168.1.25:7000/watchlist"))).toBeTruthy();
  });

  it("never caches a write, only the reads it is safe to serve stale", async () => {
    await loadWorker("https://cataloggy.example/api");

    expect(
      apiRoute()({
        url: new URL("https://cataloggy.example/api/lists/abc/items"),
        request: { method: "POST", mode: "cors" as RequestMode, destination: "" as RequestDestination },
      })
    ).toBeFalsy();
  });

  it("never caches a page navigation, even to a path the API also serves", async () => {
    // "/lists" is both an API endpoint and a React Router route.
    await loadWorker("https://cataloggy.example/api");

    expect(
      apiRoute()({
        url: new URL("https://cataloggy.example/lists"),
        request: { method: "GET", mode: "navigate" as RequestMode, destination: "document" as RequestDestination },
      })
    ).toBeFalsy();
  });

  it("takes the API base from the page, which is the only place a per-device override exists", async () => {
    await loadWorker("https://cataloggy.example/api");
    expect(apiRoute()(apiRequest("https://override.example/watchlist"))).toBeFalsy();

    await sendToWorker({ type: "SET_API_BASE", apiBase: "https://override.example" });

    expect(apiRoute()(apiRequest("https://override.example/watchlist"))).toBeTruthy();
    expect(apiRoute()(apiRequest("https://cataloggy.example/api/watchlist"))).toBeFalsy();
  });

  it("keeps matching the path tail when the page reports an empty API base", async () => {
    // A page whose config.js was never written sends "". Nothing is known
    // either way here, so the fallback has to survive the message.
    await loadWorker(null);

    await sendToWorker({ type: "SET_API_BASE", apiBase: "" });

    expect(apiRoute()(apiRequest("https://cataloggy.example/api/watchlist"))).toBeTruthy();
    expect(apiRoute()(apiRequest("http://192.168.1.25:7000/watchlist"))).toBeTruthy();
  });

  it("does not let an empty API base clobber one it already knew", async () => {
    await loadWorker("https://cataloggy.example/api");

    await sendToWorker({ type: "SET_API_BASE", apiBase: "" });

    expect(apiRoute()(apiRequest("https://cataloggy.example/api/watchlist"))).toBeTruthy();
    // Falling back to the tail match here would start caching another host's
    // responses under this origin's cache.
    expect(apiRoute()(apiRequest("https://somewhere.else/watchlist"))).toBeFalsy();
  });
});

describe("offline navigation", () => {
  const navigation = (href: string) => ({
    url: new URL(href),
    request: { method: "GET", mode: "navigate" as RequestMode, destination: "document" as RequestDestination },
  });

  const navigationRoute = () =>
    registeredRoutes.find(
      (r) => typeof r.handler === "object" && r.handler !== null && "precachedShell" in r.handler
    );

  it("answers any in-app route from the precached shell", async () => {
    // Without this, only "/" worked offline (precacheAndRoute's directoryIndex);
    // /lists, /search and a refresh on /history all hit the network and failed.
    await loadWorker("https://cataloggy.example/api");
    const route = navigationRoute();

    expect(route?.handler).toEqual({ precachedShell: "/index.html" });
    expect(route?.match(navigation("https://cataloggy.example/lists"))).toBeTruthy();
    expect(route?.match(navigation("https://cataloggy.example/calendar"))).toBeTruthy();
  });

  it("leaves navigations to the API itself alone", async () => {
    // A same-origin API is only a path away, and someone opening /api/health in
    // a tab wants the API's answer, not the app shell.
    await loadWorker("https://cataloggy.example/api");

    expect(navigationRoute()?.match(navigation("https://cataloggy.example/api/health"))).toBeFalsy();
  });

  it("does not intercept the app's own fetches", async () => {
    await loadWorker("https://cataloggy.example/api");

    expect(navigationRoute()?.match(apiRequest("https://cataloggy.example/api/watchlist"))).toBeFalsy();
  });
});

describe("poster cache keys", () => {
  const POSTER_CACHE = "poster-images-v1";
  const poster = (width: number) => `https://image.tmdb.org/t/p/w${width}/abc.jpg`;

  const posterKeyPlugin = (): CacheKeyPlugin => {
    const route = registeredRoutes.find(
      (r) => r.handler instanceof StrategyStub && r.handler.options.cacheName === POSTER_CACHE
    );
    const plugins = (route?.handler as StrategyStub | undefined)?.options.plugins ?? [];
    const plugin = plugins.find(
      (p): p is CacheKeyPlugin =>
        typeof (p as CacheKeyPlugin).cacheKeyWillBeUsed === "function"
    );
    if (!plugin) throw new Error("no cache-key plugin on the poster route");
    return plugin;
  };

  /** Puts a poster of this width in the cache, as a completed fetch would. */
  const alreadyCached = (width: number) => cacheNamed(POSTER_CACHE).set(poster(width), "bytes");

  const readKey = (url: string) => posterKeyPlugin().cacheKeyWillBeUsed({ request: { url }, mode: "read" });

  it("answers a narrow request from a wider poster that is already cached", async () => {
    // The point of the whole plugin: a title in a 342-wide grid slot whose
    // 500-wide card is already stored costs no second entry and no second
    // download. `maxEntries` counts URLs, so an entry saved is a title kept.
    await loadWorker("https://cataloggy.example/api");
    alreadyCached(500);

    await expect(readKey(poster(342))).resolves.toBe(poster(500));
  });

  it("prefers the narrowest cached variant that will do", async () => {
    await loadWorker("https://cataloggy.example/api");
    alreadyCached(500);
    alreadyCached(780);

    // Both would look right; the 500 costs a quarter of the decode.
    await expect(readKey(poster(342))).resolves.toBe(poster(500));
  });

  it("never answers from a narrower poster", async () => {
    // The failure mode a naive collapse-to-one-key has: cache the 28px history
    // thumbnail first and the shelf hero becomes a 92px image blown up to 304.
    await loadWorker("https://cataloggy.example/api");
    alreadyCached(92);

    await expect(readKey(poster(780))).resolves.toBe(poster(780));
  });

  it("does not reach past the width where a stand-in costs more than it saves", async () => {
    // 780 in a 92 slot is 90 KB and a full-size decode to draw a thumbnail.
    await loadWorker("https://cataloggy.example/api");
    alreadyCached(780);

    await expect(readKey(poster(92))).resolves.toBe(poster(92));
  });

  it("stores what it fetched under the width it fetched", async () => {
    // Writing a w92 response under a w342 key is the downgrade the read side
    // refuses to make; it must not arrive by the back door either.
    await loadWorker("https://cataloggy.example/api");
    alreadyCached(500);

    await expect(
      posterKeyPlugin().cacheKeyWillBeUsed({ request: { url: poster(342) }, mode: "write" })
    ).resolves.toBe(poster(342));
  });

  it("leaves artwork that isn't width-addressed alone", async () => {
    // The other three CDNs serve one URL per image — there is no size segment
    // to reason about.
    await loadWorker("https://cataloggy.example/api");
    const steam = "https://media.steampowered.com/steam/apps/1/header.jpg";

    await expect(readKey(steam)).resolves.toBe(steam);
  });
});

describe("writes made with no network", () => {
  const writeRoute = () => {
    const route = registeredRoutes.find((r) => r.method === "POST");
    if (!route) throw new Error("no write route registered");
    return { match: route.match, handler: route.handler as RouteHandler };
  };

  const writeQueue = () => {
    const queue = QueueStub.instances[0];
    if (!queue) throw new Error("no write queue created");
    return queue;
  };

  const post = (href: string) => ({
    url: new URL(href),
    request: { method: "POST", mode: "cors" as RequestMode, destination: "" as RequestDestination },
  });

  const offline = () =>
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

  it("takes the watch writes, and only those", async () => {
    await loadWorker("https://cataloggy.example/api");
    const { match } = writeRoute();

    expect(match(post("https://cataloggy.example/api/watch"))).toBeTruthy();
    expect(match(post("https://cataloggy.example/api/series/tt1/season/2/episode/3/watch"))).toBeTruthy();
    expect(match(post("https://cataloggy.example/api/series/tt1/season/2/watch-all"))).toBeTruthy();

    // A queue is a promise to finish something later, which only suits a write
    // whose meaning doesn't decay. These are requests about the present.
    expect(match(post("https://cataloggy.example/api/lists"))).toBeFalsy();
    expect(match(post("https://cataloggy.example/api/settings/preferences"))).toBeFalsy();
    expect(match(post("https://cataloggy.example/api/checkin"))).toBeFalsy();
    // /watch/:id is a DELETE-and-PATCH route; nothing POSTs to it.
    expect(match(post("https://cataloggy.example/api/watch/evt_1"))).toBeFalsy();
  });

  it("holds a write for nothing until it knows where the API is", async () => {
    // Guessing wrong about a read costs a stale response. Guessing wrong here
    // means replaying someone's POST into an endpoint we were never sure of.
    await loadWorker(null);

    expect(writeRoute().match(post("https://cataloggy.example/api/watch"))).toBeFalsy();
  });

  it("passes a write straight through while the network is there", async () => {
    await loadWorker("https://cataloggy.example/api");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 201 })));

    const response = await writeRoute().handler({
      request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
    });

    expect(response.status).toBe(201);
    expect(writeQueue().entries).toHaveLength(0);
  });

  it("queues a write the network refused, and says so in a way the page can read", async () => {
    await loadWorker("https://cataloggy.example/api");
    offline();

    const response = await writeRoute().handler({
      request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
    });

    // 202 and not a rethrown failure: "held, and it will be sent" is a different
    // answer from "gone", and only this worker knows which just happened.
    expect(response.status).toBe(202);
    expect(response.headers.get("X-Cataloggy-Queued")).toBe("1");
    expect(writeQueue().entries).toHaveLength(1);
  });

  it("sends what it was holding when the page says the connection is back", async () => {
    // Chromium would fire its own sync event. Nothing else does — on iOS this
    // message is the only thing that ever drains the queue.
    await loadWorker("https://cataloggy.example/api");
    writeQueue().entries.push({
      request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
    });
    const fetched = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetched);

    await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

    expect(fetched).toHaveBeenCalledTimes(1);
    expect(writeQueue().entries).toHaveLength(0);
    // Those writes changed rows the read cache is holding stale copies of.
    expect(deletedCaches).toContain("api-runtime-v1");
    expect(notifiedClients).toContainEqual({ type: "QUEUED_WRITES_REPLAYED", replayed: 1, rejected: 0 });
  });

  it("puts a write back when the network is still down, and keeps the order", async () => {
    await loadWorker("https://cataloggy.example/api");
    const first = new Request("https://cataloggy.example/api/watch", { method: "POST", body: '{"n":1}' });
    const second = new Request("https://cataloggy.example/api/watch", { method: "POST", body: '{"n":2}' });
    writeQueue().entries.push({ request: first }, { request: second });
    offline();

    await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

    // Both still there, oldest first: the queue is ordered, and a later write
    // may depend on an earlier one.
    expect(writeQueue().entries.map((e) => e.request)).toEqual([first, second]);
    expect(notifiedClients).toHaveLength(0);
  });

  it("keeps a write the API was too broken to take", async () => {
    // A 5xx is neither an outage nor a refusal: the API is there and having a
    // bad time, and nothing about this write is wrong.
    await loadWorker("https://cataloggy.example/api");
    writeQueue().entries.push({
      request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));

    await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

    expect(writeQueue().entries).toHaveLength(1);
    expect(notifiedClients).toHaveLength(0);
  });

  it("keeps a write the API rate-limited, which is the burst's own doing", async () => {
    // A reconnect sends the whole queue at once and the API is globally rate
    // limited, so a 429 on a later entry is this drain's most likely non-ok
    // answer. Dropping it would delete a watch the user was told was saved.
    await loadWorker("https://cataloggy.example/api");
    const request = new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" });
    writeQueue().entries.push({ request });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));

    await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

    expect(writeQueue().entries).toEqual([{ request }]);
    expect(notifiedClients).toHaveLength(0);
  });

  it("keeps a write the peer asked us to send again later", async () => {
    // 408 and 425 are the two that no status-class test catches.
    await loadWorker("https://cataloggy.example/api");
    for (const status of [408, 425]) {
      writeQueue().entries.push({
        request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
      });
      vi.stubGlobal("fetch", vi.fn(async () => new Response("later", { status })));

      await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

      expect(writeQueue().entries, `status ${status}`).toHaveLength(1);
      writeQueue().entries.length = 0;
    }
  });

  it("runs one drain at a time, however many callers ask for one", async () => {
    // The sync event, this message and workbox's startup replay are three
    // callers. Two interleaving their shift/unshift pairs is how a queue that
    // exists to preserve order stops preserving it.
    await loadWorker("https://cataloggy.example/api");
    for (const n of [1, 2, 3]) {
      writeQueue().entries.push({
        request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: `{"n":${n}}` }),
      });
    }
    let inFlight = 0;
    let overlapped = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await Promise.resolve();
        inFlight -= 1;
        return new Response("{}", { status: 201 });
      })
    );

    await Promise.all([
      sendToWorker({ type: "REPLAY_QUEUED_WRITES" }),
      sendToWorker({ type: "REPLAY_QUEUED_WRITES" }),
    ]);

    expect(overlapped).toBe(false);
    expect(writeQueue().entries).toHaveLength(0);
    // One announcement for the one drain, not one per caller.
    expect(notifiedClients).toEqual([{ type: "QUEUED_WRITES_REPLAYED", replayed: 3, rejected: 0 }]);
  });

  it("drops a write the server refused rather than replaying it forever", async () => {
    // The request reached the API and the API said no. Re-sending it on every
    // future sync would never produce a different answer — but the user was
    // told it was saved, so the count goes back to the page to be shown.
    await loadWorker("https://cataloggy.example/api");
    writeQueue().entries.push({
      request: new Request("https://cataloggy.example/api/watch", { method: "POST", body: "{}" }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"nope"}', { status: 400 })));

    await sendToWorker({ type: "REPLAY_QUEUED_WRITES" });

    expect(writeQueue().entries).toHaveLength(0);
    expect(notifiedClients).toContainEqual({ type: "QUEUED_WRITES_REPLAYED", replayed: 0, rejected: 1 });
  });
});
