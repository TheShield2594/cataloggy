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
type RegisteredRoute = { match: MatchCallback; handler: unknown };

const registeredRoutes: RegisteredRoute[] = [];
const messageListeners: ((event: { data?: unknown; waitUntil: (p: Promise<unknown>) => void }) => void)[] = [];

class StrategyStub {
  constructor(public readonly options: { cacheName?: string } = {}) {}
}

vi.mock("workbox-routing", () => ({
  registerRoute: (match: MatchCallback, handler: unknown) => registeredRoutes.push({ match, handler }),
}));

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: vi.fn(),
  createHandlerBoundToURL: (url: string) => ({ precachedShell: url }),
}));

vi.mock("workbox-strategies", () => ({
  CacheFirst: StrategyStub,
  NetworkOnly: StrategyStub,
  StaleWhileRevalidate: StrategyStub,
}));

vi.mock("workbox-cacheable-response", () => ({ CacheableResponsePlugin: StrategyStub }));
vi.mock("workbox-expiration", () => ({ ExpirationPlugin: StrategyStub }));

const CONFIG_JS = (apiBase: string) =>
  `window.__CATALOGGY_API_BASE__ = ${JSON.stringify(apiBase)};\nwindow.__CATALOGGY_ADDON_BASE__ = "";\n`;

/** Cache Storage is where the worker keeps the API base across restarts. */
const stubCacheStorage = () => {
  const entries = new Map<string, string>();
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (key: string) => (entries.has(key) ? new Response(entries.get(key)) : undefined),
      put: async (key: string, response: Response) => void entries.set(key, await response.text()),
    }),
    delete: vi.fn(async () => true),
  });
  return entries;
};

/** Loads the worker with `/config.js` answering with the given API base. */
const loadWorker = async (configApiBase: string | null) => {
  registeredRoutes.length = 0;
  messageListeners.length = 0;
  stubCacheStorage();
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

  /** Delivers a message to the worker and waits for whatever it kept hold of. */
  const sendToWorker = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    for (const listener of messageListeners) {
      listener({ data, waitUntil: (p) => waits.push(p) });
    }
    await Promise.all(waits);
  };

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
