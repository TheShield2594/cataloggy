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
    <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          isDropped
            ? "hover:bg-[var(--surface-strong)]"
            : "bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
        }`}
        style={isDropped ? { background: "var(--surface)", color: "var(--text-dim)" } : undefined}
      >
        {isDropped ? "✓ Dropped — Click to Undrop" : "Drop Show"}
      </button>
    </div>
  );
}
