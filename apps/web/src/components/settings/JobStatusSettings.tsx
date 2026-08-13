import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Timer } from "lucide-react";
import { api, JobFailure, JobRun } from "../../api";
import { StatusBadge } from "./StatusBadge";
import { timeAgo } from "../../utils/timeAgo";

const JOB_LABELS: Record<string, string> = {
  "trakt-history-poll": "Trakt history sync",
  "trakt-watchlist-sync": "Trakt watchlist sync",
  "stremio-library-sync": "Stremio library sync",
  "stremio-play-signals": "Stremio play signals",
  "scrobble-cleanup": "Scrobble session cleanup",
  "episode-notifications": "Upcoming episode notifications",
  "ai-recommendations": "AI recommendations refresh",
  "steam-sync": "Steam library sync",
};

const jobLabel = (job: string) => JOB_LABELS[job] ?? job;

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

// These scheduled jobs run on a timer with no user in the loop, so a failure
// is otherwise silent unless Sentry is configured (opt-in, off by default —
// see README's Security section). This surfaces the last failure of each so
// it's visible without needing Sentry.
export function JobStatusSettings() {
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<JobFailure[]>([]);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api.getJobStatus();
        setFailures(result.failures);
        setRuns(result.runs ?? []);
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

  // A job that takes longer than the interval it is scheduled on has the next
  // tick dropped — it is quietly running less often than configured, which a
  // list of failures can't show because nothing failed. A first-run Trakt
  // backfill against a large account is the case this exists for.
  const overrunning = runs.filter((run) => run.overran);
  const timed = runs.filter((run) => run.durationMs !== null);

  return (
    <div className="space-y-3">
      {failures.length === 0 && (
        <div className="flex items-center gap-3">
          <StatusBadge ok label="All scheduled jobs healthy" />
        </div>
      )}

      {failures.length > 0 && (
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
          These background jobs failed on their most recent run. They'll clear automatically once a run succeeds again.
        </p>
      )}

      {failures.map((failure) => (
        <div
          key={failure.job}
          className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        >
          <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--text)" }}>
            <AlertTriangle size={16} className="flex-none text-warning" />
            {jobLabel(failure.job)}
            <span className="ml-auto text-xs font-normal" style={{ color: "var(--text-mute)" }}>
              {timeAgo(failure.failedAt)}
            </span>
          </div>
          <p className="font-mono text-xs break-words" style={{ color: "var(--text-dim)" }}>{failure.message}</p>
        </div>
      ))}

      {overrunning.map((run) => (
        <div
          key={`overran-${run.job}`}
          className="flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
        >
          <div className="flex items-center gap-2 font-semibold" style={{ color: "var(--text)" }}>
            <Timer size={16} className="flex-none text-warning" />
            {jobLabel(run.job)}
            <span className="ml-auto text-xs font-normal" style={{ color: "var(--text-mute)" }}>
              {run.durationMs !== null && formatDuration(run.durationMs)}
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Took longer than its scheduled interval, so the next run was skipped. Harmless for a one-off backfill;
            if it keeps happening, give this job a longer interval.
          </p>
        </div>
      ))}

      {timed.length > 0 && (
        <dl className="space-y-1 text-xs" style={{ color: "var(--text-mute)" }}>
          {timed.map((run) => (
            <div key={`run-${run.job}`} className="flex items-baseline gap-2">
              <dt className="truncate">{jobLabel(run.job)}</dt>
              <dd className="ml-auto flex-none">
                {run.durationMs !== null && formatDuration(run.durationMs)} · {timeAgo(run.at)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
