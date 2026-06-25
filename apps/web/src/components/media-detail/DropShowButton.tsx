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
    <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={isDropped}
        title={isDropped ? "Undrop this show" : "Mark this show as dropped"}
        className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          isDropped
            ? "hover:bg-[var(--surface-strong)]"
            : "bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
        }`}
        style={isDropped ? { background: "var(--surface)", color: "var(--text-dim)" } : undefined}
      >
        {isDropped ? <Check className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        {isDropped ? "Dropped" : "Drop Show"}
      </button>
    </div>
  );
}
