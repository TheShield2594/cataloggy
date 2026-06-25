import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Theme, THEMES } from "../hooks/useTheme";

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (next: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(Math.max(0, THEMES.findIndex((t) => t.id === theme)));
  }, [open, theme]);

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const closeAndFocusButton = () => {
    setOpen(false);
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
      setOpen(false);
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
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors active:scale-95"
        style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className="absolute right-0 top-11 z-40 w-44 overflow-hidden rounded-xl py-1 shadow-lg"
          style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)" }}
          onKeyDown={handleMenuKeyDown}
        >
          {THEMES.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { itemRefs.current[i] = el; }}
              type="button"
              role="menuitem"
              tabIndex={activeIndex === i ? 0 : -1}
              aria-current={theme === t.id ? "true" : undefined}
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
