import { isFresh, writeCache } from "./dataCache";

// Every route but the dashboard is code-split, so the first visit to one spends
// a network round trip fetching its chunk *before* the page mounts and can even
// start requesting data. That round trip is what the spinner after a nav click
// mostly is, and it is entirely avoidable: the chunk can be in memory before the
// click happens.
//
// The `import()` specifiers here are the same ones App.tsx and MediaDetailPanel
// pass to `lazy()`. Rollup resolves both to the same module, so a prefetch and
// the later lazy render share one chunk and one in-flight request — prefetching
// mid-navigation is a dedupe, never a second download.

// Left un-annotated so callers keep the module's real type and can pull the
// named export straight out of a prefetch loader in `lazy()`.
type Loader = () => Promise<unknown>;

export const loadDashboardPage = () => import("../pages/DashboardPage");
export const loadSearchPage = () => import("../pages/SearchPage");
export const loadListsPage = () => import("../pages/ListsPage");
export const loadGamesPage = () => import("../pages/GamesPage");
export const loadCalendarPage = () => import("../pages/CalendarPage");
export const loadHistoryPage = () => import("../pages/HistoryPage");
export const loadStatsPage = () => import("../pages/StatsPage");
export const loadSettingsPage = () => import("../pages/SettingsPage");
export const loadNotFoundPage = () => import("../pages/NotFoundPage");
export const loadProfileSwitcher = () => import("../pages/ProfileSwitcher");
export const loadSetupWizard = () => import("../pages/SetupWizard");
export const loadDetailPanel = () => import("../components/media-detail/DetailPanel");
export const loadCommandPalette = () => import("../components/CommandPalette");

// Warming the chunk only removes half the wait: the page still mounts with an
// empty cache and starts its requests from zero. These fill the data cache under
// the same keys the pages read, so arriving finds both the code and the answer
// already there — and `useCachedState` paints it in the first frame.
//
// Deliberately only the one query each page opens with. Prefetching a page's
// every section would spend a hover on requests the user may never look at.
const ROUTE_DATA_WARMERS: Record<string, () => Promise<void>> = {
  "/lists": async () => {
    const { api } = await import("../api");
    const { lists } = await api.getLists();
    writeCache("lists:all", lists);
  },
  // 30 days is the calendar's default agenda range, so this is the answer the
  // page opens with. Pick another range and it fetches that one itself.
  "/calendar": async () => {
    const { api } = await import("../api");
    const { calendar } = await api.getCalendar(30);
    writeCache("calendar:entries:30", calendar ?? []);
  },
  "/history": async () => {
    const { api } = await import("../api");
    writeCache("history:events", await api.getWatchHistory(30));
  },
  "/stats": async () => {
    const { api } = await import("../api");
    const [summary, detailed] = await Promise.all([api.getWatchStats(), api.getDetailedStats()]);
    writeCache("stats:summary", summary);
    writeCache("stats:detailed", detailed);
  },
};

/** Keyed by the `to` of every nav link that points at a code-split route. */
const ROUTE_LOADERS: Record<string, Loader> = {
  "/": loadDashboardPage,
  "/search": loadSearchPage,
  "/lists": loadListsPage,
  "/games": loadGamesPage,
  "/calendar": loadCalendarPage,
  "/history": loadHistoryPage,
  "/stats": loadStatsPage,
  "/settings": loadSettingsPage
};

const started = new Set<Loader>();

function start(loader: Loader): void {
  if (started.has(loader)) return;
  started.add(loader);
  // A prefetch is a hint, not a requirement — a failed one must not reject into
  // an unhandled rejection, and must not poison the later real render, so drop
  // it from the set and let `lazy()` retry the import on its own terms.
  void loader().catch(() => started.delete(loader));
}

/**
 * Warms the chunk behind a route. Call on hover, focus or touch-start: those
 * lead a click by 100–300 ms, which is usually the whole chunk fetch on a warm
 * connection. Unknown paths and repeat calls are no-ops.
 */
export function prefetchRoute(path: string): void {
  const loader = ROUTE_LOADERS[path];
  if (loader) start(loader);

  warmRouteData(path);
}

// The key whose freshness stands in for "this page already has what it opens
// with". Hovering a page visited a moment ago should cost no request at all.
const PRIMARY_DATA_KEY: Record<string, string> = {
  "/lists": "lists:all",
  "/calendar": "calendar:entries:30",
  "/history": "history:events",
  "/stats": "stats:summary",
};

const warmersInFlight = new Set<string>();

function warmRouteData(path: string): void {
  const warmer = ROUTE_DATA_WARMERS[path];
  if (!warmer) return;
  if (warmersInFlight.has(path)) return;
  if (isFresh(PRIMARY_DATA_KEY[path])) return;
  // A hover shouldn't spend a request on a metered connection any more than the
  // idle pass should.
  if (!prefetchIsWelcome()) return;

  warmersInFlight.add(path);
  // Cleared on settle rather than kept forever, so a hover after the data has
  // gone stale warms it again instead of being permanently written off.
  void warmer()
    .catch(() => { /* a warm-up is a hint; the page's own load still runs */ })
    .finally(() => warmersInFlight.delete(path));
}

/** Warms the detail-panel chunk — the "info page" opened from any poster. */
export function prefetchDetailPanel(): void {
  start(loadDetailPanel);
}

// Prefetching costs data, which is the wrong trade on a metered or slow
// connection where the user has told the browser as much.
function prefetchIsWelcome(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== "slow-2g" && connection.effectiveType !== "2g";
}

function onIdle(run: () => void): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

// Touch devices have no hover to prefetch on, and a tab-bar tap gives no warning
// at all — so the routes reachable in one tap get warmed on idle instead, once
// the dashboard has finished its own work. Settings is deliberately absent: it
// is the largest chunk by a wide margin and the least-visited page, so it earns
// its download on hover/touch rather than on every session.
const IDLE_PREFETCH: Loader[] = [
  loadDetailPanel,
  // ⌘K expects to be instant, and there is no hover to warm it on.
  loadCommandPalette,
  loadSearchPage,
  loadListsPage,
  loadCalendarPage,
  loadHistoryPage
];

let idleScheduled = false;

/** Idempotent: safe to call from an effect that may re-run. */
export function schedulePrefetchOnIdle(): void {
  if (idleScheduled) return;
  idleScheduled = true;
  if (!prefetchIsWelcome()) return;
  onIdle(() => {
    for (const loader of IDLE_PREFETCH) start(loader);
  });
}

/** Test seam — prefetches are process-wide and would otherwise leak between cases. */
export function resetPrefetchStateForTests(): void {
  started.clear();
  warmersInFlight.clear();
  idleScheduled = false;
}

export { ROUTE_LOADERS };
