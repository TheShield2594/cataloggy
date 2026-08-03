import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router";
import { BarChart3, CalendarDays, Clapperboard, Gamepad2, History, Loader2, Search, List, Settings, User } from "lucide-react";
import { api, Profile, runtimeConfig } from "./api";
import { CommandPalette, useCommandPalette } from "./components/CommandPalette";
import { InstallButton } from "./components/InstallButton";
import { Sidebar, PIN_KEY } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { ProfileProvider, useProfile } from "./hooks/useProfile";
import { DashboardPage } from "./pages/DashboardPage";

// DashboardPage stays eager — it is the landing route. The profile switcher and
// the setup wizard are first-run/occasional surfaces, so they ride in their own
// chunks rather than in the entry bundle every visit pays for.
const ProfileSwitcher = lazy(() => import("./pages/ProfileSwitcher").then((m) => ({ default: m.ProfileSwitcher })));
const SetupWizard = lazy(() => import("./pages/SetupWizard").then((m) => ({ default: m.SetupWizard })));

const CalendarPage = lazy(() => import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const GamesPage = lazy(() => import("./pages/GamesPage").then((m) => ({ default: m.GamesPage })));
const HistoryPage = lazy(() => import("./pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const ListsPage = lazy(() => import("./pages/ListsPage").then((m) => ({ default: m.ListsPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const StatsPage = lazy(() => import("./pages/StatsPage").then((m) => ({ default: m.StatsPage })));

const mobileNavItems = [
  { to: "/", label: "Dashboard", icon: Clapperboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/games", label: "Games", icon: Gamepad2, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/history", label: "History", icon: History, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

const LoadingFallback = ({ label = "Loading…" }: { label?: string }) => (
  <div
    role="status"
    aria-live="polite"
    className="flex items-center justify-center py-24"
    style={{ color: "var(--text-dim)" }}
  >
    <Loader2 size={24} className="animate-spin" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
);

// The switcher is a full-screen modal, so suspending it to nothing would blank the
// screen between the click and the chunk arriving. Hold the overlay instead.
const ProfileSwitcherFallback = () => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
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
  const sidebarPad = sidebarPinned ? "sm:pl-[15rem]" : "sm:pl-16";

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
      <Sidebar
        pinned={sidebarPinned}
        onPinnedChange={setSidebarPinned}
        profile={profile}
        onSwitchProfile={openSwitcher}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {switcherOpen && (
        <Suspense fallback={<ProfileSwitcherFallback />}>
          <ProfileSwitcher onSelected={handleProfileSelected} onClose={closeSwitcher} />
        </Suspense>
      )}

      {/* Slim top bar */}
      <header
        className={`fixed top-0 left-0 right-0 z-30 backdrop-blur-xl transition-[padding] duration-200 ${sidebarPad}`}
        style={{ borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--bg-0) 90%, transparent)" }}
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5 text-lg font-bold sm:hidden" style={{ color: "var(--text)" }}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-claw-500">
              <Clapperboard className="h-4 w-4 text-white" />
            </div>
            <span>Cataloggy</span>
          </Link>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search (⌘K)"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-strong)] sm:h-auto sm:w-auto sm:flex-1 sm:max-w-sm sm:justify-start sm:gap-2.5 sm:px-4 sm:py-2 sm:text-sm"
            style={{ border: "1px solid var(--border-strong)", color: "var(--text-mute)", background: "var(--surface)" }}
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search</span>
            <kbd
              className="ml-auto hidden rounded px-1.5 py-0.5 text-2xs font-medium sm:inline"
              style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}
            >
              ⌘K
            </kbd>
          </button>

          <div className="flex min-w-0 items-center gap-3">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <InstallButton />
            <button
              type="button"
              onClick={openSwitcher}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
              title={profile?.name}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2 sm:hidden"
              style={{ color: "var(--text-mute)" }}
            >
              <User className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`mx-auto max-w-[1400px] px-6 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[76px] sm:pb-10 transition-[padding] duration-200 ${sidebarPad}`}>
        <Suspense fallback={<LoadingFallback />}>
          <Routes key={profile?.id ?? runtimeConfig.getProfileId() ?? "default"}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/lists/*" element={<ListsPage />} />
            <Route path="/games" element={<GamesPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden backdrop-blur-xl"
        style={{
          borderTop: "1px solid var(--border)",
          backgroundColor: "color-mix(in srgb, var(--bg-0) 96%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)"
        }}
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-2xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2 ${isActive ? "text-claw-600" : ""}`}
              style={isActive ? {} : { color: "var(--text-dim)" }}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-claw-500" aria-hidden="true" />
              )}
              <Icon className={`h-5 w-5 ${isActive ? "fill-claw-500/20" : ""}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
