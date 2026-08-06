import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { api, JobFailure } from "../../api";
import { StatusBadge } from "./StatusBadge";
import { timeAgo } from "../../utils/timeAgo";

const JOB_LABELS: Record<string, string> = {
  "trakt-history-poll": "Trakt history sync",
  "trakt-watchlist-sync": "Trakt watchlist sync",
  "stremio-library-sync": "Stremio library sync",
  "scrobble-cleanup": "Scrobble session cleanup",
  "episode-notifications": "Upcoming episode notifications",
  "ai-recommendations": "AI recommendations refresh",
  "steam-sync": "Steam library sync",
};

// These scheduled jobs run on a timer with no user in the loop, so a failure
// is otherwise silent unless Sentry is configured (opt-in, off by default —
// see README's Security section). This surfaces the last failure of each so
// it's visible without needing Sentry.
export function JobStatusSettings() {
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<JobFailure[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.getJobStatus();
        setFailures(result.failures);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load job status");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
        <Loader2 size={16} className="animate-spin" /> Checking background job status...
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="text-sm text-danger">{error}</p>;
  }

  if (failures.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <StatusBadge ok label="All scheduled jobs healthy" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        These background jobs failed on their most recent run. They'll clear automatically once a run succeeds again.
      </p>
      {failures.map((failure) => (
        <div
          key={failure.job}
          className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        >
          <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--text)" }}>
            <AlertTriangle size={16} className="flex-none text-warning" />
            {JOB_LABELS[failure.job] ?? failure.job}
            <span className="ml-auto text-xs font-normal" style={{ color: "var(--text-mute)" }}>
              {timeAgo(failure.failedAt)}
            </span>
          </div>
          <p className="font-mono text-xs break-words" style={{ color: "var(--text-dim)" }}>{failure.message}</p>
        </div>
      ))}
    </div>
  );
}
