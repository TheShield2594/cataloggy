export function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20" : "bg-ink-100 text-ink-500 ring-1 ring-ink-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-ink-400"}`} />
      {label}
    </span>
  );
}
