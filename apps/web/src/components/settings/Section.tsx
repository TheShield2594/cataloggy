import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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
  children,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readStoredOpen(storageKey, defaultOpen ?? true));
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);
  const id = useId();
  const buttonId = `${id}-toggle`;
  const panelId = `${id}-panel`;

  useEffect(() => {
    if (contentRef.current) contentRef.current.inert = !open;
  }, [open]);

  useEffect(() => {
    if (!contentRef.current) return;
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
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_PREFIX + storageKey, next ? "1" : "0");
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next;
    });
  };

  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="flex w-full items-center gap-3 px-5 py-[1.125rem] text-left transition-colors hover:bg-[var(--surface)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--surface-strong)", color: "var(--text-mute)" }}>{icon}</span>
        <span className="flex-1 text-base font-semibold" style={{ color: "var(--text)" }}>{title}</span>
        <ChevronDown
          size={18}
          className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--text-mute)" }}
        />
      </button>
      <div
        id={panelId}
        ref={contentRef}
        role="region"
        aria-labelledby={buttonId}
        style={{ height: height !== undefined ? `${height}px` : "auto" }}
        className="overflow-hidden transition-[height] duration-300 ease-in-out"
      >
        <div className="border-t px-5 py-5" style={{ borderColor: "var(--border)" }}>{children}</div>
      </div>
    </div>
  );
}
