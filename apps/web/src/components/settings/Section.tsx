import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SECTION_TITLE } from "../typography";

const STORAGE_PREFIX = "cataloggy:settings-section:";

function readStoredOpen(storageKey: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + storageKey);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export function Section({
  title,
  icon,
  defaultOpen,
  storageKey,
  alwaysOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  /** Only consulted the first time a section is seen; after that the user's own choice wins. */
  defaultOpen?: boolean;
  storageKey: string;
  /** Renders the section expanded and without a toggle (search results). */
  alwaysOpen?: boolean;
  children: ReactNode;
}) {
  const [storedOpen, setStoredOpen] = useState(() => readStoredOpen(storageKey, defaultOpen ?? false));
  const open = alwaysOpen || storedOpen;
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);
  const animatable = useRef(false);
  const id = useId();
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;

  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = !open;
  }, [open]);

  useEffect(() => {
    if (!contentRef.current) return;
    // The initial height already matches `open`; animating on mount would flash
    // a collapsed section's whole body open before sliding it shut again.
    if (!animatable.current) {
      animatable.current = true;
      return;
    }
    if (open) {
      setHeight(contentRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 300);
      return () => clearTimeout(timer);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
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
      <span className={`flex-1 ${SECTION_TITLE}`} style={{ color: "var(--text)" }}>{title}</span>
      {!alwaysOpen && (
        <ChevronDown
          size={18}
          className={`transition-transform duration-slow ${open ? "rotate-180" : ""}`}
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
      <div
        id={panelId}
        ref={contentRef}
        role="region"
        aria-labelledby={headerId}
        style={{ height: height !== undefined ? `${height}px` : "auto" }}
        className="overflow-hidden transition-[height] duration-slow ease-in-out"
      >
        <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>{children}</div>
      </div>
    </div>
  );
}
