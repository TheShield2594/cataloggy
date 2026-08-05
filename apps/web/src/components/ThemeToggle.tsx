import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Theme, THEMES } from "../hooks/useTheme";
import { useExitAnimation } from "../hooks/useExitAnimation";

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (next: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { exiting, requestClose, onExitAnimationEnd, reset } = useExitAnimation(() => setOpen(false));

  // The toggle stays mounted between opens, so opening has to clear the
  // previous close's exit state — before the render that shows the menu, or
  // it would paint a frame in its exited (invisible) end state.
  const openMenu = () => {
    reset();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) requestClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, requestClose]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, THEMES.findIndex((t) => t.id === theme)));
  }, [open, theme]);

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const closeAndFocusButton = () => {
    // Focus moves back immediately; the menu fades out behind it.
    requestClose();
    buttonRef.current?.focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % THEMES.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + THEMES.length) % THEMES.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(THEMES.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAndFocusButton();
    } else if (e.key === "Tab") {
      requestClose();
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose theme"
        onClick={() => (open ? requestClose() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          }
        }}
        // `transition-colors` here meant the active:scale-95 press had no
        // transition to run on, so the button snapped down and back instead of
        // pressing. The property list stays explicit rather than becoming
        // `transition-all`, which would also animate layout — see the base-layer
        // note in index.css.
        className="flex h-10 w-10 flex-none items-center justify-center rounded-full transition-[color,background-color,border-color,transform] duration-200 ease-in-out active:scale-95 sm:h-9 sm:w-9"
        style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className={`overlay-dialog absolute right-0 top-11 z-40 w-44 overflow-hidden rounded-xl py-1 shadow-e2 ${exiting ? "overlay-exit" : ""}`}
          style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)", transformOrigin: "top right" }}
          onKeyDown={handleMenuKeyDown}
          onAnimationEnd={onExitAnimationEnd}
        >
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitemradio"
              tabIndex={activeIndex === i ? 0 : -1}
              aria-checked={theme === t.id}
              onClick={() => {
                onChange(t.id);
                closeAndFocusButton();
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-strong)] focus-visible:bg-[var(--surface-strong)] focus-visible:outline-none"
              style={{ color: "var(--text)" }}
            >
              {t.label}
              {theme === t.id && <Check className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
