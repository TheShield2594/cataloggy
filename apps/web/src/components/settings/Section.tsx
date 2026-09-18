import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SECTION_TITLE } from "../typography";
import { healthDotClass, type SectionHealth } from "./health";

const STORAGE_PREFIX = "cataloggy:settings-section:";

function readStoredOpen(storageKey: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

/**
 * A collapsible settings section wrapped in a real `<h2>` so a screen reader can
 * jump between sections. Persists its open/closed state to localStorage (the
 * user's choice wins over the default after the first visit), reveals its body
 * by animating a grid track, and shows an integration's health dot on the
 * header row. `alwaysOpen` renders it expanded and without a toggle.
 */
export function Section({
  title,
  icon,
  defaultOpen,
  storageKey,
  alwaysOpen = false,
  health,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** Only consulted the first time a section is seen; after that the user's own choice wins. */
  defaultOpen?: boolean | undefined;
  storageKey: string;
  /** Renders the section expanded and without a toggle (search results). */
  alwaysOpen?: boolean | undefined;
  /**
   * What this integration is currently doing, shown on the header row. Absent
   * for sections that aren't integrations, and for one whose status could not
   * be read — a missing dot is honest, an alarming one would not be.
   */
  health?: SectionHealth | undefined;
  children: ReactNode;
}) {
  const [storedOpen, setStoredOpen] = useState(() => readStoredOpen(storageKey, defaultOpen ?? false));
  const open = alwaysOpen || storedOpen;
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;

  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = !open;
  }, [open]);

  const toggle = () => {
    const next = !storedOpen;
    try {
      localStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
    } catch {
      // ignore storage errors (e.g. private browsing)
    }
    setStoredOpen(next);
  };

  const header = (
    <>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}>{icon}</span>
      <span className={`min-w-0 flex-1 ${SECTION_TITLE}`} style={{ color: "var(--text)" }}>{title}</span>
      {/*
       * Status on the row, which is the whole point of the change: the answer
       * to "why isn't my history showing up" was already in the app, one level
       * inside a collapsed section, where nobody looking for it would find it.
       *
       * The dot is a wayfinding device — how you spot the one bad row in a list
       * of eighteen without reading any of them — and the words beside it are
       * what actually carry the state, so colour is never the sole channel.
       *
       * `sr-only` below `sm` rather than `hidden`: at 320px the title, the
       * status and the chevron cannot share a row, but a phone is exactly where
       * someone checks whether the sync is working, and `display: none` would
       * take the answer out of the accessibility tree along with the pixels.
       * The label sits inside the header button either way, so it is part of
       * the name announced for "TMDB Metadata, collapsed" on every viewport.
       */}
      {/* An explicit space, because the accessible name of the header button is
          the concatenation of its children and nothing else would separate
          "TMDB Metadata" from "Key set". A white-space-only text run in a flex
          container is not rendered, so this costs no pixels. */}
      {health && " "}
      {health && (
        <span className="sr-only flex-none sm:not-sr-only sm:flex sm:items-center sm:gap-2">
          <span aria-hidden="true" className={healthDotClass(health.tone)} />
          <span className="meta-row" style={{ color: "var(--text-mute)" }}>{health.label}</span>
        </span>
      )}
      {!alwaysOpen && (
        <ChevronDown
          size={18}
          className={`flex-none transition-transform duration-slow ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--text-mute)" }}
        />
      )}
    </>
  );

  return (
    <div className="glass-panel rounded-2xl border shadow-e1 overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      {/* The disclosure pattern, wrapped in a real heading.

          These sections are what the Settings page is made of — a dozen and a
          half of them, each the size of a small page — and their titles were
          <span>s. The page's outline was one <h1> and nothing else, so the
          usual way of moving around a long page with a screen reader (jump by
          heading) had nowhere to land, and the only way down was to tab
          through every control on the way.

          <h2> holds the button rather than the other way round: the heading
          has to be an ancestor of the control for the two to be one entry in
          the outline, and a button inside a heading keeps its own role. */}
      <h2 className="m-0">
        {alwaysOpen ? (
          // A span, not a div: a heading's content model is phrasing content,
          // and the button in the other branch already qualifies. `flex` comes
          // from the class either way, so this renders identically.
          <span id={headerId} className="flex w-full items-center gap-3 px-5 py-[1.125rem]">
            {header}
          </span>
        ) : (
          <button
            id={headerId}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={toggle}
            className="flex w-full items-center gap-3 px-5 py-[1.125rem] text-left transition-colors hover:bg-[var(--surface)]"
          >
            {header}
          </button>
        )}
      </h2>
      {/*
       * The reveal animates a single grid track from 0fr to 1fr rather than an
       * explicit pixel height. `transition-[height]` had to read scrollHeight on
       * every toggle — a forced synchronous layout — then hand back to `auto` on
       * a 300ms timer that a mid-animation toggle couldn't interrupt. One grid
       * track interpolates to the content's own size with no measurement, and
       * retargets from wherever it is when toggled again. It is still a layout
       * animation on purpose — the sections below have to move to make room —
       * but a declarative, interruptible one, and it names the one property it
       * touches instead of leaning on `transition-all`. The reduced-motion block
       * in index.css collapses the transition to instant.
       */}
      <div
        className="grid transition-[grid-template-rows] duration-slow ease-in-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div
          id={panelId}
          ref={contentRef}
          role="region"
          aria-labelledby={headerId}
          // min-h-0 lets the grid track shrink the row past its content's min
          // size, and overflow-hidden clips the body while the row is collapsing.
          className="min-h-0 overflow-hidden"
        >
          <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
