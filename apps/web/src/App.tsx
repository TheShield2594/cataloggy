import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Clapperboard, LayoutDashboard, Search, List, Settings } from "lucide-react";
import "@fontsource-variable/plus-jakarta-sans";
import { InstallButton } from "./components/InstallButton";
import { DashboardPage } from "./pages/DashboardPage";
import { ListsPage } from "./pages/ListsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

const desktopNavClass = ({ isActive }: { isActive: boolean }) =>
  `relative px-3 py-2 text-sm font-medium rounded-full ${
    isActive
      ? "bg-sky-500/20 text-sky-300"
      : "text-slate-300 hover:text-slate-100 hover:bg-slate-800"
  }`;

export function App() {
  const location = useLocation();

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 pb-20 pt-6 sm:pb-6">
      {/* Sticky header */}
      <header className="sticky top-0 z-50 -mx-4 mb-6 flex items-center justify-between backdrop-blur bg-slate-950/80 px-4 py-3 border-b border-slate-800/50">
        <Link to="/" className="flex items-center gap-2 text-xl font-semibold text-sky-300 font-heading">
          <Clapperboard className="h-6 w-6" />
          Cataloggy
        </Link>
        <div className="flex items-center gap-3">
          <InstallButton />
          {/* Desktop nav - hidden on mobile */}
          <nav className="hidden sm:flex gap-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end ?? false} className={desktopNavClass}>
                {({ isActive }) => (
                  <>
                    {item.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-4/5 rounded-full bg-sky-400" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/lists/*" element={<ListsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex sm:hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-2xs ${
                isActive ? "text-sky-400" : "text-slate-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
