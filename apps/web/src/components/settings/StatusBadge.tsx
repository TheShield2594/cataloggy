export function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-success ring-1 ring-emerald-500/20" : "ring-1"
      }`}
      style={ok ? undefined : { background: "var(--surface-strong)", color: "var(--text-mute)", boxShadow: "inset 0 0 0 1px var(--border-strong)" }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : ""}`}
        style={ok ? undefined : { background: "var(--text-mute)" }}
      />
      {label}
    </span>
  );
}
