import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  BarChart3,
  CalendarDays,
  Clapperboard,
  Gamepad2,
  History,
  List,
  MoreHorizontal,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { prefetchRoute } from "../utils/routePrefetch";
import { useExitAnimation } from "../hooks/useExitAnimation";

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

// Five tabs is the platform convention, and the practical ceiling: with eight,
// the bar's labels could not shrink below their own width, so at 320px it
// overflowed by 24px — clipped (not scrolled) by `overflow-x: hidden` on the
// body, which cost Settings its label and half its hit area. Everything past
// the fifth slot lives behind "More".
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: Clapperboard, end: true },
  { to: "/search", label: "Search", icon: Search },
  { to: "/lists", label: "Lists", icon: List },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
];

export const MORE_NAV_ITEMS: NavItem[] = [
  { to: "/games", label: "Games", icon: Gamepad2 },
  { to: "/history", label: "History", icon: History },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const isItemActive = (item: NavItem, pathname: string) =>
  item.end ? pathname === item.to : pathname.startsWith(item.to);

const TAB_CLASSES =
  "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2.5 text-2xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 focus-ring-offset";

const ActiveMarker = () => (
  <span className="absolute top-0 h-0.5 w-8 rounded-full bg-claw-500" aria-hidden="true" />
);

export function MobileTabBar({ pathname }: { pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreActive = MORE_NAV_ITEMS.some((item) => isItemActive(item, pathname));

  const closeMore = () => {
    setMoreOpen(false);
    // Send focus back to the tab that opened the sheet rather than dropping it
    // at the top of the document.
    moreButtonRef.current?.focus();
  };

  return (
    <>
      {moreOpen && <MoreSheet pathname={pathname} onClose={closeMore} />}

      <nav
        aria-label="Mobile navigation"
        className="glass-surface fixed bottom-0 left-0 right-0 z-40 flex sm:hidden backdrop-blur-xl"
        style={{
          borderTop: "1px solid var(--border)",
          backgroundColor: "color-mix(in srgb, var(--bg-0) 96%, transparent)",
          paddingBottom: "env(safe-area-inset-bottom)"
        }}
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item, pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isActive ? "page" : undefined}
              className={`${TAB_CLASSES} ${isActive ? "text-claw-text" : ""}`}
              style={isActive ? {} : { color: "var(--text-dim)" }}
              // Touch-down leads the click by ~100 ms, and on a warm connection
              // that is most of the chunk fetch. The idle pass in App.tsx has
              // usually beaten us here; this covers the taps that come first.
              onTouchStart={() => prefetchRoute(item.to)}
            >
              {isActive && <ActiveMarker />}
              <Icon className={`h-5 w-5 flex-none ${isActive ? "fill-claw-500/20" : ""}`} />
              {/* `min-w-0` on the tab plus `truncate` here means a label gives
                  way before the bar can outgrow the viewport. */}
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}

        <button
          ref={moreButtonRef}
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={`${TAB_CLASSES} ${moreActive ? "text-claw-text" : ""}`}
          style={moreActive ? {} : { color: "var(--text-dim)" }}
        >
          {moreActive && <ActiveMarker />}
          <MoreHorizontal className={`h-5 w-5 flex-none ${moreActive ? "fill-claw-500/20" : ""}`} />
          <span className="max-w-full truncate">More</span>
        </button>
      </nav>
    </>
  );
}

function MoreSheet({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);

  useEffect(() => {
    firstLinkRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [requestClose]);

  return (
    <div className="fixed inset-0 z-50 sm:hidden" role="dialog" aria-modal="true" aria-label="More destinations">
      <button
        type="button"
        aria-label="Close menu"
        onClick={requestClose}
        className={`overlay-scrim overlay-fade absolute inset-0 h-full w-full ${exiting ? "overlay-exit" : ""}`}
      />
      <div
        className={`glass-surface overlay-sheet absolute bottom-0 left-0 right-0 rounded-t-2xl p-2 ${exiting ? "overlay-exit" : ""}`}
        onAnimationEnd={onExitAnimationEnd}
        style={{
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <ul className="space-y-1">
          {MORE_NAV_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const isActive = isItemActive(item, pathname);
            return (
              <li key={item.to}>
                <Link
                  ref={index === 0 ? firstLinkRef : undefined}
                  to={item.to}
                  // Navigation happens on the click; the sheet slides out over
                  // the destination page.
                  onClick={requestClose}
                  onTouchStart={() => prefetchRoute(item.to)}
                  onPointerEnter={() => prefetchRoute(item.to)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-claw-400 ${isActive ? "text-claw-text" : ""}`}
                  style={isActive ? { background: "var(--surface)" } : { color: "var(--text-dim)" }}
                >
                  <Icon className="h-5 w-5 flex-none" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
