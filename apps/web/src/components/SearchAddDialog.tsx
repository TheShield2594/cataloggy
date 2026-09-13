import { type ReactNode, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useExitAnimation } from "../hooks/useExitAnimation";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useScrollLock } from "../hooks/useScrollLock";
import { useVisualViewport } from "../hooks/useVisualViewport";
import { SECTION_TITLE } from "./typography";

/**
 * The chrome around a search-to-add dialog: the scrim, the dialog, the focus
 * trap, the search box, and the scrolling results area.
 *
 * Lists ("add a title to this list") and Games ("add a game") are the same
 * dialog with different rows in it, and were written twice — down to the
 * keyboard handling, the exit animation and the `min-h-0 flex-auto` that keeps
 * the list clear of a phone's on-screen keyboard. What differs between them is
 * the query itself and what a result looks like, so that is what they pass in.
 */
export function SearchAddDialog({
  title,
  titleId,
  query,
  onQueryChange,
  placeholder,
  inputLabel,
  filters,
  onClose,
  children,
}: {
  title: string;
  /** Ties the dialog to its heading; unique per dialog on the page. */
  titleId: string;
  query: string;
  onQueryChange: (query: string) => void;
  placeholder: string;
  inputLabel: string;
  /** A filter row under the search box, for a dialog that has one. */
  filters?: ReactNode | undefined;
  onClose: () => void;
  /** The results, rendered by the caller. */
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);
  const viewportStyle = useVisualViewport();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useScrollLock();
  useEscapeKey(requestClose);

  return (
    <div
      className={`overlay-scrim overlay-fade fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-[10vh] ${exiting ? "overlay-exit" : ""}`}
      style={viewportStyle}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={exiting}
        className={`glass-surface overlay-dialog flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl border shadow-e3 ${exiting ? "overlay-exit" : ""}`}
        style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={onExitAnimationEnd}
      >
        <div className="flex flex-none items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <h3 id={titleId} className={SECTION_TITLE} style={{ color: "var(--text)" }}>{title}</h3>
          <button onClick={requestClose} aria-label="Close dialog" className="rounded-lg p-1.5 hover:bg-[var(--surface)] hover:text-[var(--text)]" style={{ color: "var(--text-mute)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-none border-b px-5 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-mute)" }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={placeholder}
              aria-label={inputLabel}
              className="w-full rounded-full border py-2.5 pl-9 pr-3 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}
            />
          </div>
          {filters}
        </div>

        {/* `flex-auto` + `min-h-0`, not a `vh` cap: the list takes whatever the
            dialog has left over, so on a phone with the keyboard up it stops
            where the keyboard starts instead of scrolling on behind it. */}
        <div className="min-h-0 flex-auto overflow-y-auto px-5 py-3 sm:max-h-[50vh]">{children}</div>
      </div>
    </div>
  );
}

/**
 * One result in such a dialog: artwork, a title and a line under it, and
 * whatever the trailing control is — a plus, a spinner, a tick.
 *
 * The whole row is the button, because the row has exactly one action.
 */
export function SearchAddResultRow({
  thumbnail,
  title,
  subtitle,
  trailing,
  disabled,
  muted = disabled,
  onAdd,
}: {
  /** The artwork, or the placeholder a caller draws when there is none. */
  thumbnail: ReactNode;
  title: string;
  subtitle: ReactNode;
  trailing: ReactNode;
  disabled: boolean;
  /** Dims the title. Defaults to `disabled`; pass `false` for a row that is only busy. */
  muted?: boolean | undefined;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      // Nothing distinguished an item already in the list, so adding the same
      // title twice looked exactly like adding it once.
      disabled={disabled}
      onClick={onAdd}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface)] disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <div
        className="h-14 w-10 flex-none overflow-hidden rounded-lg ring-1"
        style={{ backgroundColor: "var(--surface)", "--tw-ring-color": "var(--border)" } as React.CSSProperties}
      >
        {thumbnail}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: muted ? "var(--text-mute)" : "var(--text)" }}>
          {title}
        </p>
        <p className="text-xs" style={{ color: "var(--text-mute)" }}>{subtitle}</p>
      </div>
      {trailing}
    </button>
  );
}
