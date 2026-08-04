import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { api, PlaySignal } from "../../api";
import { StatusBadge } from "./StatusBadge";
import { timeAgo } from "../../utils/timeAgo";

const titleOf = (signal: PlaySignal): string =>
  signal.type === "episode" && signal.season !== null && signal.episode !== null
    ? `${signal.imdbId} S${signal.season}E${signal.episode}`
    : signal.imdbId;

const dueLabel = (dueAt: string): string => {
  const remainingMs = new Date(dueAt).getTime() - Date.now();
  if (remainingMs <= 0) return "due now";
  const minutes = Math.round(remainingMs / 60000);
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
};

// Play detection infers watches rather than observing them, so this exists to
// make that inference inspectable: a self-hoster can see exactly what their
// clients send, and which pending titles are about to be counted, before
// deciding to trust it.
export function PlayDetectionSettings() {
  const [enabled, setEnabled] = useState(false);
  const [signals, setSignals] = useState<PlaySignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    try {
      const result = await api.getStremioPlaySignals();
      setEnabled(result.enabled);
      setSignals(result.signals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load play signals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
        <Loader2 size={16} className="animate-spin" /> Loading play signals...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge ok={enabled} label={enabled ? "Enabled" : "Disabled"} />
      </div>

      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        Stremio add-ons are never told what you watched — a client only ever asks them for things. Play
        detection treats those requests as intent: opening a title's streams, or loading a player, starts a
        pending watch that only counts once the runtime has elapsed without you moving to something else.
        This covers apps that keep their library to themselves, like Vidi, Omni and Nuvio.
      </p>

      {!enabled && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Off by default, because it infers watches instead of observing them. Set{" "}
          <code className="select-all">STREMIO_PLAY_DETECTION=true</code> on both the <code>api</code> and{" "}
          <code>addon</code> services to turn it on.
        </p>
      )}

      {enabled && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fetchSignals}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] border border-[var(--border-strong)]"
              style={{ color: "var(--text-dim)", background: "var(--bg-1)" }}
            >
              <RefreshCw size={16} /> Refresh
            </button>
          </div>

          {signals.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>
              Nothing pending. Play something in a Stremio-add-on app and it will appear here — which is also
              how you can check whether that app signals at all.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--text-dim)" }}>
                    <th scope="col" className="px-2 py-1 text-left font-semibold">Title</th>
                    <th scope="col" className="px-2 py-1 text-left font-semibold">Signal</th>
                    <th scope="col" className="px-2 py-1 text-left font-semibold">Client</th>
                    <th scope="col" className="px-2 py-1 text-left font-semibold">Started</th>
                    <th scope="col" className="px-2 py-1 text-left font-semibold">Counts</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((signal) => (
                    <tr key={signal.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-2 py-1.5">{titleOf(signal)}</td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-dim)" }}>{signal.resource}</td>
                      <td className="px-2 py-1.5 max-w-[16rem] truncate" style={{ color: "var(--text-dim)" }}>
                        {signal.client ?? "unknown"}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-dim)" }}>
                        {timeAgo(signal.firstSeenAt)}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: "var(--text-dim)" }}>
                        {dueLabel(signal.dueAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle size={16} /> {error}
        </p>
      )}
    </div>
  );
}
