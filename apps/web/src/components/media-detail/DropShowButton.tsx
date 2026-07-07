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

  const handleClick = () => {
    if (isDropped) {
      onToggle();
      return;
    }
    if (window.confirm("Drop this show? Your progress will be marked as dropped and it will no longer count toward continue watching.")) {
      onToggle();
    }
  };

  return (
    <div className="flex justify-end pt-1">
      <button
        type="button"
        onClick={handleClick}
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
