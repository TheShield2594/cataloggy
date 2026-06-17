export function MiniBarChart({ data, active = true }: { data: number[]; active?: boolean }) {
  const max = Math.max(...data, 1);
  const barW = 10;
  const gap = 4;
  const chartH = 40;
  const totalW = data.length * barW + (data.length - 1) * gap;

  return (
    <svg width={totalW} height={chartH} aria-hidden="true">
      {data.map((v, i) => {
        const barH = Math.max((v / max) * chartH, 2);
        const x = i * (barW + gap);
        const isLatest = i === data.length - 1;
        return (
          <rect
            key={i}
            x={x}
            y={chartH - barH}
            width={barW}
            height={barH}
            rx={3}
            fill={isLatest && active ? "var(--accent)" : "var(--surface-strong)"}
          />
        );
      })}
    </svg>
  );
}

/** A "ticket stub" shaped stat tile — Cataloggy's signature collectible-stat motif. */
export function TicketTile({
  icon: Icon,
  label,
  value,
  sub,
  bars,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  bars?: number[];
}) {
  return (
    <div className="relative">
      <div
        className="rounded-2xl px-4 py-4 flex flex-col gap-2"
        style={{ border: "1px solid var(--border)", background: "var(--bg-1)" }}
      >
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-claw-400" />
          <span className="text-2xs font-medium uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>
            {label}
          </span>
        </div>
        <span className="text-2xl font-bold tabular-nums leading-none truncate" style={{ color: "var(--text)" }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {bars && bars.length > 0 ? (
          <MiniBarChart data={bars} />
        ) : sub ? (
          <p className="text-2xs" style={{ color: "var(--text-dim)" }}>{sub}</p>
        ) : null}
      </div>
      {/* perforated notches, ticket-stub motif */}
      <span
        className="absolute -left-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full"
        style={{ background: "var(--bg-0)" }}
      />
      <span
        className="absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full"
        style={{ background: "var(--bg-0)" }}
      />
    </div>
  );
}
