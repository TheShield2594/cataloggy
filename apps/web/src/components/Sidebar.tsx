import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { BarChart3, CalendarDays, Clapperboard, Gamepad2, History, Pin, PinOff, Search, List, Settings, User } from "lucide-react";
import { Profile } from "../api";

const navItems = [
  { to: "/", label: "Dashboard", icon: Clapperboard, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/games", label: "Games", icon: Gamepad2, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/history", label: "History", icon: History, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

export const PIN_KEY = "cataloggy:sidebar-pinned";
const HINT_KEY = "cataloggy:sidebar-hint-seen";
const HOVER_DELAY_MS = 200;

export function Sidebar({
  pinned,
  onPinnedChange,
  profile,
  onSwitchProfile,
}: {
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  profile?: Profile | null;
  onSwitchProfile?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // One-time discovery hint: the hover-to-expand / pin pattern is invisible until
  // you happen to hover, so surface it the first time the rail expands, then never again.
  const [showHint, setShowHint] = useState(false);
  const hintSeenRef = useRef(true);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const expanded = pinned || hovered;

  useEffect(() => {
    hintSeenRef.current = localStorage.getItem(HINT_KEY) === "1";
  }, []);

  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  const dismissHint = () => {
    setShowHint(false);
    hintSeenRef.current = true;
    localStorage.setItem(HINT_KEY, "1");
  };

  const handleMouseEnter = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHovered(true);
      // First hover-expand ever: reveal the hint (and mark it seen so it stays a one-off).
      if (!hintSeenRef.current && !pinned) {
        setShowHint(true);
        hintSeenRef.current = true;
        localStorage.setItem(HINT_KEY, "1");
      }
    }, HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimerRef.current);
    setHovered(false);
    setShowHint(false);
  };

  const togglePin = () => {
    const next = !pinned;
    onPinnedChange(next);
    localStorage.setItem(PIN_KEY, next ? "1" : "0");
    if (showHint) dismissHint();
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
            <Clapperboard className="h-4.5 w-4.5 text-claw-on" />
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
                `group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2 ${
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
          {showHint && expanded && (
            <div
              role="status"
              className="mb-2 rounded-lg p-3 text-xs shadow-lg"
              style={{ background: "var(--surface-strong)", border: "1px solid var(--border-strong)" }}
            >
              <p className="font-semibold" style={{ color: "var(--text)" }}>Quick tip</p>
              <p className="mt-1 leading-snug" style={{ color: "var(--text-dim)" }}>
                Hover this rail to peek, or pin it below to keep it open.
              </p>
              <button
                type="button"
                onClick={dismissHint}
                className="mt-2 rounded-md bg-claw-500 px-2.5 py-1 text-2xs font-semibold text-claw-on transition-colors hover:bg-claw-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400"
              >
                Got it
              </button>
            </div>
          )}
          {onSwitchProfile && (
            <button
              type="button"
              onClick={onSwitchProfile}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
              style={{ color: "var(--text-dim)" }}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
            >
              <span className="flex h-[1.1rem] w-[1.1rem] flex-none items-center justify-center rounded-full" style={{ background: "var(--surface-strong)" }}>
                <User className="h-3 w-3" />
              </span>
              <span className="truncate whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
                {profile?.name ?? "Switch profile"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={togglePin}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-visible:ring-offset-2"
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
