import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { BarChart3, CalendarDays, Clapperboard, Gamepad2, History, Pin, PinOff, Search, List, Settings, User } from "lucide-react";
import { Profile } from "../api";
import { BRAND_WORDMARK, BrandMark } from "./BrandMark";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { prefetchRoute } from "../utils/routePrefetch";

export const SIDEBAR_NAV_ITEMS = [
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
const HINT_AUTO_DISMISS_MS = 15000;

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
  // Keyboard users can't hover, and the collapsed rail hides its labels — so
  // tabbing into it has to expand it too, or the nav is eight bare icons with
  // no way to reveal what they are short of picking up the mouse.
  const [focused, setFocused] = useState(false);
  // One-time discovery hint: the hover-to-expand / pin pattern is invisible until
  // you happen to hover, so surface it once on the first visit, then never again.
  const [showHint, setShowHint] = useState(false);
  const hintSeenRef = useRef(true);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Read once: the tip is about the state the rail was found in, and re-reading
  // `pinned` would resurrect it the first time someone unpins.
  const pinnedAtMountRef = useRef(pinned);
  // Matches the `hidden sm:flex` this component styles itself with.
  const railVisible = useMediaQuery("(min-width: 640px)");
  const expanded = pinned || hovered || focused;

  // One marker for the whole rail, moved to the active item — rather than one
  // per item, mounted and unmounted, which teleported the rail's only piece of
  // state from wherever it was to wherever it now belongs. Measured off the
  // active link rather than derived from the index, so it stays correct if an
  // item's height ever stops matching its neighbours'.
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    // NavLink writes aria-current on whichever link matched, which spares us
    // re-implementing its `end`/trailing-slash rules to find the same one.
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    setMarker(active ? { top: active.offsetTop, height: active.offsetHeight } : null);
    // `railVisible` as well as the route: below `sm` the whole rail is
    // `display: none`, where every offset measures zero. Widening the window
    // past 640px is not a navigation, so without this the rail would appear
    // with its marker still holding those zeroes until the next route change.
  }, [location.pathname, railVisible]);

  useEffect(() => {
    hintSeenRef.current = localStorage.getItem(HINT_KEY) === "1";
  }, []);

  useEffect(() => {
    // Shown unprompted rather than on first hover-expand, which was the bug:
    // the tip explaining that hovering expands the rail could only be read by
    // someone who had already discovered that hovering expands the rail. It
    // renders beside the rail, so the collapsed state doesn't clip it.
    //
    // Gated on the rail being on screen at all — below `sm` this component is
    // `display: none` and the bottom tab bar navigates instead, so firing here
    // would spend a one-time tip on a viewport that never showed it. A rail
    // already pinned when the app loaded needs no tip about pinning it either.
    if (!railVisible || hintSeenRef.current || pinnedAtMountRef.current) return;
    setShowHint(true);
    hintSeenRef.current = true;
    localStorage.setItem(HINT_KEY, "1");
    // A discovery tip is not an alert — let it retire on its own if it is
    // ignored, rather than leaving a card parked over the page forever.
    hintTimerRef.current = setTimeout(() => setShowHint(false), HINT_AUTO_DISMISS_MS);
  }, [railVisible]);

  useEffect(() => () => {
    clearTimeout(hoverTimerRef.current);
    clearTimeout(hintTimerRef.current);
  }, []);

  const dismissHint = () => {
    clearTimeout(hintTimerRef.current);
    setShowHint(false);
    hintSeenRef.current = true;
    localStorage.setItem(HINT_KEY, "1");
  };

  const handleMouseEnter = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovered(true), HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimerRef.current);
    setHovered(false);
  };

  // React's onFocus/onBlur are focusin/focusout, so they also fire as focus
  // moves between two controls inside the rail. That is not focus leaving, and
  // collapsing on it would snap the labels shut mid-traversal.
  const handleBlur = (event: React.FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false);
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
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    >
      <div
        className="glass-surface flex h-full flex-col py-4 transition-[width] duration-base ease-out overflow-hidden"
        style={{
          width: expanded ? "15rem" : "4rem",
          background: "var(--bg-1)",
          borderRight: "1px solid var(--border)",
          boxShadow: expanded && !pinned ? "8px 0 24px rgba(0,0,0,0.12)" : "none",
        }}
      >
        <div className="flex items-center gap-2.5 px-4 pb-5" style={{ color: "var(--text)" }}>
          <BrandMark className="h-8 w-8 flex-none" />
          <span
            className={`whitespace-nowrap text-base transition-opacity ${BRAND_WORDMARK}`}
            style={{ opacity: expanded ? 1 : 0 }}
          >
            Cataloggy
          </span>
        </div>

        <nav ref={navRef} aria-label="Primary" className="relative flex flex-1 flex-col gap-1 px-2.5">
          {marker && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-0 w-[3px] rounded-full bg-claw-500 transition-transform duration-slow ease-out"
              // 6px in from each end of the row, which is where the marker sat
              // when it was a child of the link itself (`top-1.5 bottom-1.5`).
              // Floored at 0 for the layout-less case (jsdom, `display: none`),
              // where every offset measures zero and the inset would go negative.
              style={{ height: Math.max(marker.height - 12, 0), transform: `translateY(${marker.top + 6}px)` }}
            />
          )}
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset ${
                  isActive ? "" : "hover:bg-[var(--surface-strong)]"
                }`
              }
              style={({ isActive }) => ({ color: isActive ? "var(--text)" : "var(--text-dim)" })}
              // Pointer-user fallback while the label is hidden: without it the
              // collapsed rail is eight icons with nothing to hover for a name.
              title={expanded ? undefined : item.label}
              // Start the route's chunk on the approach rather than on the
              // click, so the page is usually already in memory by the time it
              // is asked for. Keyboard focus counts as an approach too.
              onPointerEnter={() => prefetchRoute(item.to)}
              onFocus={() => prefetchRoute(item.to)}
            >
              <item.icon className="h-[1.1rem] w-[1.1rem] flex-none" />
              <span className="whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="px-2.5">
          {onSwitchProfile && (
            <button
              type="button"
              onClick={onSwitchProfile}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
              style={{ color: "var(--text-dim)" }}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
              title={expanded ? undefined : (profile?.name ?? "Switch profile")}
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
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--surface-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset"
            style={{ color: "var(--text-dim)" }}
            aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
            title={expanded ? undefined : pinned ? "Unpin sidebar" : "Pin sidebar open"}
          >
            {pinned ? <PinOff className="h-[1.1rem] w-[1.1rem] flex-none" /> : <Pin className="h-[1.1rem] w-[1.1rem] flex-none" />}
            <span className="whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
              {pinned ? "Unpin" : "Pin open"}
            </span>
          </button>
        </div>
      </div>

      {/* Outside the rail, which clips its own overflow — so the tip is legible
          while the rail is still collapsed, which is the only state it is
          actually about. Positioned rather than laid out, so it never widens
          the rail or shifts the nav. */}
      {showHint && (
        <div
          role="status"
          className="absolute bottom-4 w-56 rounded-lg p-3 text-xs shadow-e2 transition-[left] duration-base ease-out"
          style={{
            left: expanded ? "15.5rem" : "4.5rem",
            background: "var(--surface-strong)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <p className="font-semibold" style={{ color: "var(--text)" }}>Quick tip</p>
          <p className="mt-1 leading-snug" style={{ color: "var(--text-dim)" }}>
            Hover this rail to peek, or pin it open to keep the labels.
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
    </aside>
  );
}
