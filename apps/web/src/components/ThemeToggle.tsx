import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Theme, THEMES } from "../hooks/useTheme";

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (next: Theme) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose theme"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors active:scale-95"
        style={{ border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-11 z-40 w-44 overflow-hidden rounded-xl py-1 shadow-lg"
          style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)" }}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={theme === t.id}
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface-strong)]"
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
