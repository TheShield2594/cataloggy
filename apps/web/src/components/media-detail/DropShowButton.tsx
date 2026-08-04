import { Check, X } from "lucide-react";

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
    <div className="flex justify-end pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isDropped}
        title={isDropped ? "Undrop this show" : "Mark this show as dropped"}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
          isDropped ? "text-[var(--text-dim)] hover:text-rose-500" : "text-[var(--text-mute)] hover:text-rose-500"
        }`}
      >
        {isDropped ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
        {isDropped ? "Dropped" : "Drop Show"}
      </button>
    </div>
  );
}
