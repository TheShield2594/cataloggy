import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { BarChart3, Clapperboard, History, Search, List, Settings, User } from "lucide-react";
import { api, Profile, runtimeConfig } from "./api";
import { CommandPalette, useCommandPalette } from "./components/CommandPalette";
import { InstallButton } from "./components/InstallButton";
import { Sidebar, PIN_KEY } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { useTheme } from "./hooks/useTheme";
import { ToastProvider } from "./hooks/useToast";
import { ProfileProvider, useProfile } from "./hooks/useProfile";
import { DashboardPage } from "./pages/DashboardPage";
import { HistoryPage } from "./pages/HistoryPage";
import { ListsPage } from "./pages/ListsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProfileSwitcher } from "./pages/ProfileSwitcher";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupWizard } from "./pages/SetupWizard";
import { StatsPage } from "./pages/StatsPage";

const mobileNavItems = [
  { to: "/", label: "Dashboard", icon: Clapperboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/history", label: "History", icon: History, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
] as const;

export function App() {
  const location = useLocation();
  const [needsSetup, setNeedsSetup] = useState(() => !runtimeConfig.getToken());
  const [needsProfile, setNeedsProfile] = useState(() => !runtimeConfig.getProfileId());
  const { theme, setTheme } = useTheme();
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem(PIN_KEY) === "1");
  const sidebarPad = sidebarPinned ? "sm:pl-[15rem]" : "sm:pl-16";

  if (needsSetup) {
    return (
      <SetupWizard
        onComplete={() => {
          setNeedsSetup(false);
          setNeedsProfile(!runtimeConfig.getProfileId());
        }}
      />
    );
  }

  if (needsProfile) {
    return (
      <ProfileSwitcher
        onSelected={(profile) => {
          runtimeConfig.setProfileId(profile.id);
          setNeedsProfile(false);
        }}
      />
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
        <ProfileSwitcher onSelected={handleProfileSelected} onClose={closeSwitcher} />
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
            className="flex flex-1 max-w-sm items-center gap-2.5 rounded-full px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-strong)]"
            style={{ border: "1px solid var(--border-strong)", color: "var(--text-mute)", background: "var(--surface)" }}
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search everything...</span>
            <span className="sm:hidden">Search</span>
            <kbd
              className="ml-auto hidden rounded px-1.5 py-0.5 text-2xs font-medium sm:inline"
              style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}
            >
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-3">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <InstallButton />
            <button
              type="button"
              onClick={openSwitcher}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
              title={profile?.name}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2 sm:hidden"
              style={{ color: "var(--text-mute)" }}
            >
              <User className="h-5 w-5" />
            </button>
            <Link
              to="/settings"
              aria-label="Settings"
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2 sm:hidden ${location.pathname.startsWith("/settings") ? "text-claw-600" : ""}`}
              style={location.pathname.startsWith("/settings") ? {} : { color: "var(--text-mute)" }}
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className={`mx-auto max-w-[1400px] px-6 pb-24 pt-[76px] sm:pb-10 transition-[padding] duration-200 ${sidebarPad}`}>
        <Routes key={profile?.id ?? "default"}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/lists/*" element={<ListsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden backdrop-blur-xl"
        style={{ borderTop: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--bg-0) 96%, transparent)" }}
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

      {/* Footer */}
      <footer
        className={`py-8 text-center text-sm transition-[padding] duration-200 ${sidebarPad}`}
        style={{ borderTop: "1px solid var(--border)", color: "var(--text-mute)" }}
      >
        Cataloggy &middot; Personal Media Tracker
      </footer>
    </div>
  );
}
