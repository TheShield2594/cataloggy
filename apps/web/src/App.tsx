import { Link, NavLink, Route, Routes } from "react-router-dom";
import { InstallButton } from "./components/InstallButton";
import { DashboardPage } from "./pages/DashboardPage";
import { ListsPage } from "./pages/ListsPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-sky-500/20 text-sky-200" : "text-slate-300 hover:bg-slate-800"}`;

export function App() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <Link to="/" className="text-xl font-semibold text-sky-300">
          Cataloggy
        </Link>
        <div className="flex items-center gap-3">
          <InstallButton />
          <nav className="flex gap-2">
            <NavLink to="/" end className={navClass}>
              Dashboard
            </NavLink>
            <NavLink to="/search" className={navClass}>
              Search
            </NavLink>
            <NavLink to="/lists" className={navClass}>
              Lists
            </NavLink>
            <NavLink to="/settings" className={navClass}>
              Settings
            </NavLink>
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
    </div>
  );
}
