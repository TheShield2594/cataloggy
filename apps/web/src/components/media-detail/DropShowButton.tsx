import { Check, X } from "lucide-react";

/**
 * Dropping a show changes how the app tracks it, so it belongs with the other
 * tracking controls rather than where it used to sit: a small text link in the
 * bottom-right corner below "More like this", after every other section of the
 * panel, styled as a footnote. A state-changing action shouldn't read as an
 * afterthought — and "Drop Show" on its own never said what dropping does.
 */
export function DropShowButton({
  isDropped,
  loading,
  onToggle,
}: {
  isDropped: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  if (loading) return null;

  // No confirm: dropping is reversible from the toast the panel raises, and a
  // native dialog here was the only blocking confirm in an otherwise
  // toast-driven flow.
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {isDropped ? "Dropped" : "Drop this show"}
        </p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-mute)" }}>
          {isDropped
            ? "Hidden from Continue Watching and up-next suggestions."
            : "Stops it appearing in Continue Watching and up-next suggestions."}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isDropped}
        className="btn-secondary flex-none"
      >
        {isDropped ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        {isDropped ? "Undrop" : "Drop show"}
      </button>
    </div>
  );
}
