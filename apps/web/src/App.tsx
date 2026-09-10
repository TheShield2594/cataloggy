import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import { Search, User } from "lucide-react";
import { api, Profile, runtimeConfig } from "./api";
import { useCommandPalette } from "./hooks/useCommandPalette";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GhostLoader } from "./components/GhostLoader";
import { InstallButton } from "./components/InstallButton";
import { MobileTabBar } from "./components/MobileTabBar";
import { OfflineBanner } from "./components/OfflineBanner";
import { Sidebar, PIN_KEY } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { useScrolled } from "./hooks/useScrolled";
import { SettingsHealthProvider } from "./hooks/useSettingsHealth";
import { useTheme } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { ProfileProvider, useProfile } from "./hooks/useProfile";
import { ShelfPage } from "./pages/ShelfPage";
import {
  loadCalendarPage,
  loadDashboardPage,
  loadGamesPage,
  loadHistoryPage,
  loadListsPage,
  loadNotFoundPage,
  loadProfileSwitcher,
  loadSearchPage,
  loadSettingsPage,
  loadSetupWizard,
  loadStatsPage,
  loadCommandPalette,
  schedulePrefetchOnIdle,
} from "./utils/routePrefetch";

// ShelfPage stays eager — it is the landing route. The profile switcher and
// the setup wizard are first-run/occasional surfaces, so they ride in their own
// chunks rather than in the entry bundle every visit pays for.
//
// The loaders come from routePrefetch so a nav link can warm the very same chunk
// on hover, before the click that renders it.
const ProfileSwitcher = lazy(() => loadProfileSwitcher().then((m) => ({ default: m.ProfileSwitcher })));
const SetupWizard = lazy(() => loadSetupWizard().then((m) => ({ default: m.SetupWizard })));

// Closed on every cold start, and plenty of sessions never open it — but once
// it has been opened it stays mounted, because it keeps rendering a detail panel
// opened from a result after the palette itself closes. Unmounting on close
// would take that panel with it.
const CommandPalette = lazy(() => loadCommandPalette().then((m) => ({ default: m.CommandPalette })));

const CalendarPage = lazy(() => loadCalendarPage().then((m) => ({ default: m.CalendarPage })));
// Discovery — trending, recommendations, the poster rails. This was the landing
// route until the Shelf took that job; it is now the second destination rather
// than the first, so it is code-split like every other one.
const DashboardPage = lazy(() => loadDashboardPage().then((m) => ({ default: m.DashboardPage })));
const GamesPage = lazy(() => loadGamesPage().then((m) => ({ default: m.GamesPage })));
const HistoryPage = lazy(() => loadHistoryPage().then((m) => ({ default: m.HistoryPage })));
const ListsPage = lazy(() => loadListsPage().then((m) => ({ default: m.ListsPage })));
const NotFoundPage = lazy(() => loadNotFoundPage().then((m) => ({ default: m.NotFoundPage })));
const SearchPage = lazy(() => loadSearchPage().then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => loadSettingsPage().then((m) => ({ default: m.SettingsPage })));
const StatsPage = lazy(() => loadStatsPage().then((m) => ({ default: m.StatsPage })));

const LoadingFallback = ({ label = "Loading…" }: { label?: string }) => (
  <GhostLoader label={label} className="items-center py-24" />
);

/**
 * What each route calls itself in the tab strip and the history menu.
 *
 * `index.html` ships one <title> for the whole app, which is right for the
 * document the server sends and wrong for every screen after it: a router that
 * never touches document.title leaves nine destinations all announcing
 * "Cataloggy", so the tab strip, the back-button menu and a screen reader's
 * page-title announcement carry no information at all.
 *
 * Kept beside the <Routes> below rather than on each page, so a new route can't
 * be added without the omission being visible here.
 */
const ROUTE_TITLES: Record<string, string> = {
  "/": "Shelf",
  "/search": "Search",
  "/discover": "Discover",
  "/lists": "Lists",
  "/games": "Games",
  "/calendar": "Calendar",
  "/history": "Watch History",
  "/stats": "Watch Statistics",
  "/settings": "Settings",
};

const APP_NAME = "Cataloggy";

export function routeTitle(pathname: string): string {
  const name = ROUTE_TITLES[pathname];
  return name ? `${name} · ${APP_NAME}` : `Page not found · ${APP_NAME}`;
}

// The switcher is a full-screen modal, so suspending it to nothing would blank the
// screen between the click and the chunk arriving. Hold the overlay instead.
const ProfileSwitcherFallback = () => (
  <div
    className="overlay-scrim overlay-fade fixed inset-0 z-50 flex items-center justify-center"
    aria-busy="true"
  >
    <LoadingFallback label="Loading profiles…" />
  </div>
);

export function App() {
  const location = useLocation();
  const [needsSetup, setNeedsSetup] = useState(() => !runtimeConfig.getToken());
  const [needsProfile, setNeedsProfile] = useState(() => !runtimeConfig.getProfileId());
  const { theme, setTheme } = useTheme();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem(PIN_KEY) === "1");
  // The rail bleeds under the left notch and insets its own contents (see
  // Sidebar.tsx), so the space the shell reserves for it has to grow by the
  // same inset or the header and the page slide back under the housing.
  const sidebarPad = sidebarPinned
    ? "sm:pl-[calc(15rem_+_env(safe-area-inset-left))]"
    : "sm:pl-[calc(4rem_+_env(safe-area-inset-left))]";

  useEffect(() => {
    const handleUnauthorized = () => setNeedsSetup(true);
    window.addEventListener("cataloggy:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("cataloggy:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    // A PIN-protected profile's access token expired or was cleared — send the
    // user back to the profile picker to re-verify.
    const handleProfileLocked = () => setNeedsProfile(true);
    window.addEventListener("cataloggy:profile-locked", handleProfileLocked);
    return () => window.removeEventListener("cataloggy:profile-locked", handleProfileLocked);
  }, []);

  if (needsSetup) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <SetupWizard
          onComplete={() => {
            setNeedsSetup(false);
            setNeedsProfile(!runtimeConfig.getProfileId());
          }}
        />
      </Suspense>
    );
  }

  if (needsProfile) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <ProfileSwitcher
          onSelected={(profile) => {
            runtimeConfig.setProfileId(profile.id);
            setNeedsProfile(false);
          }}
        />
      </Suspense>
    );
  }

  return (
    <ToastProvider>
    <ProfileProvider initialProfile={null}>
      {/* One health report for the whole shell: the rail's Sources rows and the
          Settings page's status board ask the same six questions, and they are
          both mounted at once on /settings. */}
      <SettingsHealthProvider>
      <AppShell
        sidebarPinned={sidebarPinned}
        setSidebarPinned={setSidebarPinned}
        sidebarPad={sidebarPad}
        paletteOpen={paletteOpen}
        setPaletteOpen={setPaletteOpen}
        theme={theme}
        setTheme={setTheme}
        location={location}
      />
      </SettingsHealthProvider>
    </ProfileProvider>
    </ToastProvider>
  );
}

function AppShell({
  sidebarPinned,
  setSidebarPinned,
  sidebarPad,
  paletteOpen,
  setPaletteOpen,
  theme,
  setTheme,
  location,
}: {
  sidebarPinned: boolean;
  setSidebarPinned: (pinned: boolean) => void;
  sidebarPad: string;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  theme: ReturnType<typeof useTheme>["theme"];
  setTheme: ReturnType<typeof useTheme>["setTheme"];
  location: ReturnType<typeof useLocation>;
}) {
  const { profile, setProfile, switcherOpen, openSwitcher, closeSwitcher } = useProfile();
  const mainRef = useRef<HTMLElement>(null);
  const onSearchRoute = location.pathname === "/search";
  // Drives the nav bar's material — see the header below, and useScrolled.
  const scrolled = useScrolled();

  // Warm the chunks a tap can reach with no hover to warn us first. Runs on
  // idle, so it queues behind the dashboard's own render and requests.
  useEffect(() => { schedulePrefetchOnIdle(); }, []);

  // Latches on first open and never unmounts after — see the lazy import above.
  const [paletteMounted, setPaletteMounted] = useState(paletteOpen);
  useEffect(() => { if (paletteOpen) setPaletteMounted(true); }, [paletteOpen]);

  // Client-side navigation leaves focus on the nav item that was clicked, so a
  // screen reader stays parked in the sidebar while the page behind it swaps
  // out. Move focus into the new content instead — but only on an actual route
  // change, not on the first render (where it would steal focus from the page
  // the user just loaded) and not on a hash change from the skip link, which
  // already lands there.
  const previousPathname = useRef(location.pathname);
  useEffect(() => {
    if (previousPathname.current === location.pathname) return;
    previousPathname.current = location.pathname;
    mainRef.current?.focus();
  }, [location.pathname]);

  // Runs on the first render too, unlike the focus move above: the landing
  // route needs a title as much as a navigated-to one does.
  useEffect(() => {
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    const currentId = runtimeConfig.getProfileId();
    if (!currentId) return;
    void (async () => {
      try {
        const { profiles } = await api.getProfiles();
        if (cancelled) return;
        const current = profiles.find((p) => p.id === currentId);
        if (current) setProfile(current);
      } catch {
        // best-effort; profile indicator just won't show a name
      }
    })();
    return () => { cancelled = true; };
  }, [setProfile]);

  const handleProfileSelected = (next: Profile) => {
    setProfile(next);
  };

  return (
    <div className="min-h-screen w-full">
      {/* First focusable element in the shell: without it, reaching content
          means tabbing the whole sidebar and top bar on every route. */}
      <a
        href="#main-content"
        // `not-sr-only` zeroes the padding it restores, so the box has to be
        // rebuilt under the same variant rather than set unconditionally.
        className="sr-only rounded-xl text-sm font-semibold shadow-e2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:px-4 focus:py-2.5 focus:outline-none focus:ring-2 focus:ring-focus"
        style={{ background: "var(--bg-1)", color: "var(--text)", border: "1px solid var(--border-strong)" }}
      >
        Skip to main content
      </a>
      {/*
       * Keyed on the profile, exactly as <Routes> below is, and for the same
       * reason — which only became a reason when the rail started holding data.
       *
       * `useCachedState` pins the cache scope each mount reads and writes
       * under, and deliberately never refreshes it: an answer that lands after
       * a profile switch belongs to whoever asked for it, and writing it under
       * the new scope is how one profile paints another's rows. Its note says
       * every consumer is a route page and route pages remount on a switch.
       * The rail is the first consumer that is chrome, and chrome does not
       * remount — so without this it would hold the previous profile's lists
       * for the life of the tab, and lose its own on the first load too (the
       * scope moves from empty to the real one the moment the profile lands).
       */}
      <Sidebar
        key={profile?.id ?? runtimeConfig.getProfileId() ?? "default"}
        pinned={sidebarPinned}
        onPinnedChange={setSidebarPinned}
        profile={profile}
        onSwitchProfile={openSwitcher}
      />
      {paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </Suspense>
      )}
      {switcherOpen && (
        <Suspense fallback={<ProfileSwitcherFallback />}>
          <ProfileSwitcher onSelected={handleProfileSelected} onClose={closeSwitcher} />
        </Suspense>
      )}

      {/*
       * The nav bar.
       *
       * Transparent while the page is at the top and materialising once
       * anything has scrolled under it — tint, blur, and a hairline — which is
       * what a large-title bar does on the platform. At rest the page's own
       * title is the top of the screen and there is no chrome above it at all;
       * the bar exists to separate the controls from content only once there is
       * content to separate them from.
       *
       * `backdrop-filter` is declared unconditionally rather than toggled with
       * the tint: switching it on and off promotes and demotes a compositor
       * layer mid-scroll, which is a visible hitch on a phone. It is a blur of
       * nothing while the bar is transparent.
       */}
      <header
        className={`fixed top-0 left-0 right-0 z-30 backdrop-blur-xl transition-[padding,background-color,border-color] duration-base ${sidebarPad}`}
        style={{
          borderBottom: `0.5px solid ${scrolled ? "var(--border)" : "transparent"}`,
          backgroundColor: scrolled ? "var(--bar-tint)" : "transparent",
        }}
      >
        <div className="safe-pr mx-auto flex max-w-[1400px] items-center justify-between gap-4 pl-4 py-2 [--gutter-r:1rem] sm:pl-6 sm:py-2.5 sm:[--gutter-r:1.5rem]">
          {/* The search page puts its own field at the top of the content, so the
              header trigger would be a second search box that quietly does
              something else — it opens the palette rather than filling the page.
              Stand it down there and leave a spacer, so the controls on the right
              sit in the same place on every route. ⌘K still reaches the palette. */}
          {/* The toolbar's search field — desktop only. The phone reaches the
              same place through the circle beside the tab bar, and a field up
              here as well would be a second search box that quietly does
              something else (this one opens the palette; that one opens the
              page).

              Stood down on the search route itself, where the page puts its own
              field at the top of the content, with a spacer in its place so the
              controls on the right sit still between routes. ⌘K still reaches
              the palette from anywhere. */}
          <div className="flex-1" aria-hidden={onSearchRoute ? "true" : undefined}>
            {!onSearchRoute && (
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Search (⌘K)"
                className="hidden h-7 w-full max-w-[13.75rem] items-center gap-2 rounded-lg px-2.5 text-[0.8125rem] transition-colors hover:bg-[var(--surface-strong)] sm:flex"
                style={{ border: "0.5px solid var(--border)", color: "var(--text-mute)", background: "var(--surface)" }}
              >
                <Search className="h-3.5 w-3.5 flex-none" />
                <span>Search</span>
                <kbd className="ml-auto text-2xs font-medium tabular-nums" style={{ color: "var(--text-mute)" }}>
                  ⌘K
                </kbd>
              </button>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <InstallButton />
            {/* The profile, as the platform draws it: a filled circle in the
                trailing corner carrying the initial, not an outline of a
                person. Below `sm` only — the rail's footer is the same control
                on a desktop, and two of them on one screen is two answers to
                "who is this". */}
            <button
              type="button"
              onClick={openSwitcher}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
              title={profile?.name}
              className="tap-target flex h-[2.125rem] w-[2.125rem] flex-none items-center justify-center rounded-full text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset sm:hidden"
              style={{
                background: "linear-gradient(145deg, rgb(var(--accent-2-rgb)), rgb(var(--accent-rgb)))",
                color: "var(--on-accent)",
              }}
            >
              {/* A dot rather than a blank circle while the profile is still in
                  flight — an empty avatar reads as a broken one. */}
              {profile?.name?.trim().charAt(0).toUpperCase() ?? <User className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main
        id="main-content"
        ref={mainRef}
        // Not reachable by Tab — `-1` only makes it a valid target for the skip
        // link and for the focus move on route change.
        tabIndex={-1}
        aria-label="Main content"
        // Bottom padding clears the floating tab bar (64px) and the gap it sits
        // in, so the last row of a grid isn't parked behind glass.
        className={`safe-pl safe-pr mx-auto max-w-[1400px] pb-[calc(7rem+env(safe-area-inset-bottom))] pt-[60px] focus:outline-none [--gutter-l:1.25rem] [--gutter-r:1.25rem] sm:pb-10 sm:pt-[68px] sm:[--gutter-l:1.5rem] sm:[--gutter-r:1.5rem] transition-[padding] duration-base ${sidebarPad}`}
      >
        <OfflineBanner />
        {/* Keyed on the pathname so the entrance replays once per navigation.
            The key also remounts the outgoing page, which `<Routes>` does on a
            route change anyway — this only extends it to a same-element route
            (the dashboard's own link), where a replay is still what's wanted. */}
        <div key={location.pathname} className="route-enter">
          {/* The second boundary, inside the shell. main.tsx's wraps the whole
              tree, so before this one a render error on any page took the
              header, sidebar and tab bar down with it and left the user with no
              way to reach a page that still worked. This one contains the
              damage to the content column.

              Keyed on the pathname so the fallback belongs to the route that
              threw: without it, navigating away would carry the error state to
              the next page. It wraps <Suspense> rather than sitting inside it,
              so a lazy chunk that fails to load is caught here too. */}
          <ErrorBoundary key={location.pathname} variant="page">
            <Suspense fallback={<LoadingFallback />}>
              <Routes key={profile?.id ?? runtimeConfig.getProfileId() ?? "default"}>
                <Route path="/" element={<ShelfPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/discover" element={<DashboardPage />} />
                <Route path="/lists" element={<ListsPage />} />
                <Route path="/games" element={<GamesPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <MobileTabBar pathname={location.pathname} />
    </div>
  );
}
