import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { BarChart3, Clapperboard, History, Pin, PinOff, Search, List, Settings } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: Clapperboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/history", label: "History", icon: History, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

export const PIN_KEY = "cataloggy:sidebar-pinned";
const HOVER_DELAY_MS = 200;

export function Sidebar({ pinned, onPinnedChange }: { pinned: boolean; onPinnedChange: (pinned: boolean) => void }) {
  const [hovered, setHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const expanded = pinned || hovered;

  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  const handleMouseEnter = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovered(true), HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimerRef.current);
    setHovered(false);
  };

  const togglePin = () => {
    const next = !pinned;
    onPinnedChange(next);
    localStorage.setItem(PIN_KEY, next ? "1" : "0");
  };

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden sm:flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="flex h-full flex-col py-4 transition-[width] duration-200 ease-out overflow-hidden"
        style={{
          width: expanded ? "15rem" : "4rem",
          background: "var(--bg-1)",
          borderRight: "1px solid var(--border)",
          boxShadow: expanded && !pinned ? "8px 0 24px rgba(0,0,0,0.12)" : "none",
        }}
      >
        <div className="flex items-center gap-2.5 px-4 pb-5">
          <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-claw-500">
            <Clapperboard className="h-4.5 w-4.5 text-white" />
          </div>
          <span
            className="whitespace-nowrap text-base font-bold transition-opacity"
            style={{ color: "var(--text)", opacity: expanded ? 1 : 0 }}
          >
            Cataloggy
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? "" : "hover:bg-[var(--surface-strong)]"
                }`
              }
              style={({ isActive }) => ({ color: isActive ? "var(--text)" : "var(--text-dim)" })}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-claw-500" />
                  )}
                  <item.icon className="h-[1.1rem] w-[1.1rem] flex-none" />
                  <span className="whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-2.5">
          <button
            type="button"
            onClick={togglePin}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)]"
            style={{ color: "var(--text-dim)" }}
            aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
          >
            {pinned ? <PinOff className="h-[1.1rem] w-[1.1rem] flex-none" /> : <Pin className="h-[1.1rem] w-[1.1rem] flex-none" />}
            <span className="whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
              {pinned ? "Unpin" : "Pin open"}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}
