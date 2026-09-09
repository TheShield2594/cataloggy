import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { BarChart3, CalendarDays, Compass, Gamepad2, History, Library, List, Pin, PinOff, Search, Settings, User } from "lucide-react";
import { Profile } from "../api";
import { BRAND_WORDMARK, BrandMark } from "./BrandMark";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { prefetchRoute } from "../utils/routePrefetch";

/*
 * Six destinations, down from eight.
 *
 * Lists, Games and History were never really places — they were three filters
 * over one collection, each given a tab because of the table it happened to be
 * stored in. The Shelf is that collection, and its filter row does what the
 * three tabs did. All three pages still exist as the surfaces where you
 * *manage* things (make a list, add a game, read the full log); they are linked
 * from the Shelf's header, which is where you are when you want one.
 *
 * What is left is six things that genuinely differ: what you have (Shelf), what
 * you're looking for (Search), what you might want (Discover), what's coming
 * (Calendar), what you've done (Stats), and how it all works (Settings).
 */
export const SIDEBAR_NAV_ITEMS = [
  { to: "/", label: "Shelf", icon: Library, end: true },
  { to: "/search", label: "Search", icon: Search, end: false },
  { to: "/discover", label: "Discover", icon: Compass, end: false },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, end: false },
  { to: "/stats", label: "Stats", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
] as const;

/**
 * The second group: where you go to *change* how the shelf is organised, as
 * opposed to the six above, which are places to look at it.
 *
 * These three used to be a row of links in the Shelf's own header, which put
 * them in the middle of the page, level with a subtitle, on one screen out of
 * nine. A source list is where a desktop app keeps this kind of thing, under a
 * heading that says which kind it is — and the mobile bar already files them
 * the same way, behind "More".
 */
export const SIDEBAR_MANAGE_ITEMS = [
  { to: "/lists", label: "Lists", icon: List, end: false },
  { to: "/games", label: "Games", icon: Gamepad2, end: false },
  { to: "/history", label: "History", icon: History, end: false },
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
  // tabbing into it has to expand it too, or the nav is a column of bare icons
  // with no way to reveal what they are short of picking up the mouse.
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
  //
  // The mechanism is unchanged and the shape is not: it was a 3px bar down the
  // leading edge, and a source list on the platform selects a row by filling
  // it. A rule beside a row is a margin note about it; a fill is the row being
  // the one you are on, and it is also the only treatment that still reads once
  // the rail is collapsed to icons.
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
      // Named because the Lists page has a complementary landmark of its own,
      // and two unnamed ones are indistinguishable in a landmark list.
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 z-40 hidden sm:flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    >
      <div
        className="glass-surface flex h-full flex-col overflow-hidden py-3 backdrop-blur-xl transition-[width] duration-base"
        style={{
          width: expanded ? "15rem" : "4rem",
          // Translucent rather than opaque: a source list on the platform is a
          // pane the window's material shows through, and the app's own content
          // scrolls past behind it.
          background: "color-mix(in srgb, var(--bg-1) 86%, transparent)",
          borderRight: "0.5px solid var(--border)",
          boxShadow: expanded && !pinned ? "8px 0 24px rgba(0,0,0,0.18)" : "none",
          transitionTimingFunction: "var(--ease-ios)",
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
              className="pointer-events-none absolute inset-x-2.5 top-0 rounded-[0.4375rem] transition-transform duration-slow"
              style={{
                height: marker.height,
                transform: `translateY(${marker.top}px)`,
                background: "var(--surface-strong)",
                transitionTimingFunction: "var(--ease-ios)",
              }}
            />
          )}
          {SIDEBAR_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-[0.4375rem] px-2.5 py-[0.4375rem] text-[0.8125rem] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset ${
                  isActive ? "font-medium" : "hover:bg-[var(--surface)]"
                }`
              }
              style={({ isActive }) => ({ color: isActive ? "var(--text)" : "var(--text-dim)" })}
              // Pointer-user fallback while the label is hidden: without it the
              // collapsed rail is a column of icons with nothing to hover for a name.
              title={expanded ? undefined : item.label}
              // Start the route's chunk on the approach rather than on the
              // click, so the page is usually already in memory by the time it
              // is asked for. Keyboard focus counts as an approach too.
              onPointerEnter={() => prefetchRoute(item.to)}
              onFocus={() => prefetchRoute(item.to)}
            >
              {/* Accent-tinted whether or not the row is selected, which is
                  how a source list draws its glyphs — the fill behind the row
                  is what says which one you are on, so the icon is free to be
                  the app's colour rather than a second selection signal. */}
              <item.icon
                className="h-[1.0625rem] w-[1.0625rem] flex-none"
                strokeWidth={2}
                style={{ color: "rgb(var(--accent-rgb))" }}
              />
              <span className="whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
                {item.label}
              </span>
            </NavLink>
          ))}

          {/* Fades out with the labels rather than being replaced by a rule:
              a heading over a column of unlabelled icons names nothing. */}
          <p
            className="px-2.5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.04em] transition-opacity"
            style={{ color: "var(--text-mute)", opacity: expanded ? 1 : 0 }}
          >
            Manage
          </p>
          {SIDEBAR_MANAGE_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-[0.4375rem] px-2.5 py-[0.4375rem] text-[0.8125rem] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset ${
                  isActive ? "font-medium" : "hover:bg-[var(--surface)]"
                }`
              }
              style={({ isActive }) => ({ color: isActive ? "var(--text)" : "var(--text-dim)" })}
              title={expanded ? undefined : item.label}
              onPointerEnter={() => prefetchRoute(item.to)}
              onFocus={() => prefetchRoute(item.to)}
            >
              <item.icon
                className="h-[1.0625rem] w-[1.0625rem] flex-none"
                strokeWidth={2}
                style={{ color: "rgb(var(--accent-rgb))" }}
              />
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
              className="flex w-full items-center gap-2.5 rounded-[0.4375rem] px-2.5 py-[0.4375rem] text-[0.8125rem] transition-colors hover:bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
              style={{ color: "var(--text-dim)" }}
              aria-label={profile ? `Switch profile (currently ${profile.name})` : "Switch profile"}
              title={expanded ? undefined : (profile?.name ?? "Switch profile")}
            >
              <span
                className="flex h-[1.0625rem] w-[1.0625rem] flex-none items-center justify-center rounded-full text-[0.5rem] font-bold"
                style={{
                  background: "linear-gradient(145deg, rgb(var(--accent-2-rgb)), rgb(var(--accent-rgb)))",
                  color: "var(--on-accent)",
                }}
              >
                {profile?.name?.trim().charAt(0).toUpperCase() ?? <User className="h-3 w-3" />}
              </span>
              <span className="truncate whitespace-nowrap" style={{ opacity: expanded ? 1 : 0 }}>
                {profile?.name ?? "Switch profile"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={togglePin}
            className="flex w-full items-center gap-2.5 rounded-[0.4375rem] px-2.5 py-[0.4375rem] text-[0.8125rem] transition-colors hover:bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
            style={{ color: "var(--text-dim)" }}
            aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
            title={expanded ? undefined : pinned ? "Unpin sidebar" : "Pin sidebar open"}
          >
            {pinned ? (
              <PinOff className="h-[1.0625rem] w-[1.0625rem] flex-none" strokeWidth={2} />
            ) : (
              <Pin className="h-[1.0625rem] w-[1.0625rem] flex-none" strokeWidth={2} />
            )}
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
          className="absolute bottom-4 w-56 rounded-lg p-3 text-xs shadow-e2 transition-[left] duration-base ease-out"
          style={{
            left: expanded ? "15.5rem" : "4.5rem",
            background: "var(--surface-strong)",
            border: "1px solid var(--border-strong)",
          }}
        >
          {/* The live region holds the prose and nothing else. It used to wrap the
              button as well, so the tip was announced with a control folded into
              the middle of it that then had to be hunted down — a live region
              reads its contents out, it doesn't hand you what's inside. Outside
              it, the button is still the very next thing in the tab order. */}
          <div role="status">
            <p className="font-semibold" style={{ color: "var(--text)" }}>Quick tip</p>
            <p className="mt-1 leading-snug" style={{ color: "var(--text-dim)" }}>
              Hover this rail to peek, or pin it open to keep the labels.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissHint}
            // "Got it" alone says nothing about what it acts on once the tip is no
            // longer being read. The visible text stays inside the accessible name,
            // which is what SC 2.5.3 asks.
            aria-label="Got it — dismiss quick tip"
            className="btn-primary btn-xs mt-2"
          >
            Got it
          </button>
        </div>
      )}
    </aside>
  );
}
