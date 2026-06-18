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

  return (
    <div className="pt-2 border-t border-ink-100">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          isDropped
            ? "bg-ink-100 text-ink-700 hover:bg-ink-200"
            : "bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
        }`}
      >
        {isDropped ? "✓ Dropped — Click to Undrop" : "Drop Show"}
      </button>
    </div>
  );
}
