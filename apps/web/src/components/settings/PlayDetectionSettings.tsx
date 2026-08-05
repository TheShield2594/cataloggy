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
  // null means "not known yet" — a failed request must not be reported as
  // "Disabled", which reads as a settled fact and sends people off to change
  // config that was never the problem.
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
      setEnabled(null);
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
        {enabled === null ? (
          <span className="text-sm" style={{ color: "var(--text-dim)" }}>
            Status unavailable
          </span>
        ) : (
          <StatusBadge ok={enabled} label={enabled ? "Enabled" : "Disabled"} />
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        Stremio add-ons are never told what you watched — a client only ever asks them for things. Play
        detection treats those requests as intent: opening a title's streams, or loading a player, starts a
        pending watch that only counts once the runtime has elapsed without you moving to something else.
        This covers apps that keep their library to themselves, like Vidi, Omni and Nuvio.
      </p>

      {enabled === false && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Off by default, because it infers watches instead of observing them. Set{" "}
          <code className="select-all">STREMIO_PLAY_DETECTION=true</code> on both the <code>api</code> and{" "}
          <code>addon</code> services to turn it on.
        </p>
      )}

      {enabled === true && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={fetchSignals}
              className="btn-secondary"
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
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-rose-600">
            <AlertCircle size={16} /> {error}
          </p>
          {/* Reachable whatever `enabled` is: when the request failed there is
              no other control on screen, so without this the panel is a dead
              end until the whole page is reloaded. */}
          <button
            type="button"
            onClick={fetchSignals}
            className="btn-secondary"
          >
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
