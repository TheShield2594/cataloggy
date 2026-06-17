import { useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BarChart3, Clapperboard, LayoutDashboard, Search, List, Settings, Sun, Moon } from "lucide-react";
import { runtimeConfig } from "./api";
import { InstallButton } from "./components/InstallButton";
import { useTheme } from "./hooks/useTheme";
import { DashboardPage } from "./pages/DashboardPage";
import { ListsPage } from "./pages/ListsPage";
import { ProfileSwitcher } from "./pages/ProfileSwitcher";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupWizard } from "./pages/SetupWizard";
import { StatsPage } from "./pages/StatsPage";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

export function App() {
  const location = useLocation();
  const [needsSetup, setNeedsSetup] = useState(() => !runtimeConfig.getToken());
  const [needsProfile, setNeedsProfile] = useState(() => !runtimeConfig.getProfileId());
  const { theme, toggleTheme } = useTheme();

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
    return <ProfileSwitcher onSelected={() => setNeedsProfile(false)} />;
  }

  return (
    <div className="min-h-screen w-full">
      {/* Fixed header */}
      <header
        className="fixed top-0 left-0 right-0 z-30 backdrop-blur-xl"
        style={{ borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--bg-0) 90%, transparent)" }}
      >
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2.5 text-xl font-bold" style={{ color: "var(--text)" }}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-claw-500">
              <Clapperboard className="h-5 w-5 text-white" />
            </div>
            <span className="hidden sm:inline">Cataloggy</span>
          </Link>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-95"
              style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <InstallButton />

            {/* Desktop pill nav */}
            <nav
              className="hidden sm:flex rounded-full p-1"
              style={{ border: "1px solid var(--border-strong)", backgroundColor: "var(--surface-strong)" }}
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end ?? false}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                      isActive ? "bg-claw-500 text-white shadow-lg shadow-claw-500/20" : "hover:opacity-80"
                    }`
                  }
                  style={({ isActive }: { isActive: boolean }) =>
                    isActive ? {} : { color: "var(--text-dim)" }
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-[1400px] px-6 pb-24 pt-[88px] sm:pb-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/lists/*" element={<ListsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden backdrop-blur-xl"
        style={{ borderTop: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--bg-0) 96%, transparent)" }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-2xs font-medium transition-colors ${isActive ? "text-claw-600" : ""}`}
              style={isActive ? {} : { color: "var(--text-dim)" }}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <footer
        className="py-8 text-center text-sm"
        style={{ borderTop: "1px solid var(--border)", color: "var(--text-mute)" }}
      >
        Cataloggy &middot; Personal Media Tracker
      </footer>
    </div>
  );
}
