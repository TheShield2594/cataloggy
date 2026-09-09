import type { JobFailure, JobRun, StremioLibraryStatus, TmdbStatus } from "../../api";

/*
 * Settings, leading with health.
 *
 * Everything below is already in the app — the Sync Status section knows which
 * jobs failed, and each integration's own panel knows whether it has a key.
 * The problem was where it was: one level inside a collapsed accordion, so the
 * question that actually brings someone to this page — "why isn't my history
 * showing up?" — had to be answered by opening sections one at a time until
 * one of them looked wrong.
 *
 * So the state moves onto the row. A dot and a handful of words per section,
 * and a line at the top that counts them, which between them turn a list of
 * eighteen forms into a status board that happens to be editable.
 *
 * The colour is never the whole message: `label` says which state a row is in,
 * because "connected" and "not set up" differ only in hue otherwise (SC 1.4.1),
 * and because "Token expired" is the actual answer to the question.
 */

/**
 * Four states, not three. The trio the app's --status-* tokens describe is
 * about things that are *working or not*; a source nobody has set up is doing
 * exactly what it was asked to and must not borrow the colour of a fault. That
 * distinction is also what makes the summary count meaningful — 5 of 6 healthy
 * says something; 5 of 18 would just be a list of features not in use.
 */
export type HealthTone = "ok" | "warn" | "bad" | "idle";

export type SectionHealth = {
  tone: HealthTone;
  /** Short enough for a row: "4m ago", "Token expired", "Not set up". */
  label: string;
  /**
   * The same state in as few words as it can be put, for the 220px rail, where
   * `label` would truncate mid-word. Set only where the two differ — the rail
   * falls back to `label`, which is short enough almost everywhere.
   */
  short?: string;
};

/*
 * Every mapper below takes its own status as a *non-null* value, on purpose.
 *
 * "We asked, and there is no key" and "we could not ask" are different answers,
 * and only the first belongs on a row: reporting `No key — artwork is off`
 * because a request timed out is worse than reporting nothing. The caller drops
 * a failed request instead of passing null down (see `useSettingsHealth`), and
 * these signatures are what stop that from quietly regressing.
 *
 * `jobs` is the exception and stays nullable: the sync rows read it only for a
 * timestamp, and a row that says "Connected" without a "synced 4m ago" is still
 * true.
 */

/** The status-dot modifier for a tone. `idle` takes the unmodified dot. */
export const healthDotClass = (tone: HealthTone): string =>
  tone === "ok" ? "status-dot status-dot--ok"
    : tone === "warn" ? "status-dot status-dot--warn"
      : tone === "bad" ? "status-dot status-dot--bad"
        : "status-dot";

export type JobStatus = { failures: JobFailure[]; runs?: JobRun[] };

/**
 * When a named job last completed, as words, or null if it has never been seen.
 *
 * A source that is connected but has never actually run is not the same as one
 * that ran four minutes ago, and saying "Connected" for both is how a silently
 * broken webhook goes unnoticed for a week.
 */
export function lastRunLabel(
  jobs: JobStatus | null,
  job: string,
  timeAgo: (iso: string) => string
): string | null {
  const run = jobs?.runs?.find((r) => r.job === job);
  return run ? timeAgo(run.at) : null;
}

/** The recorded failure for a named job, if its last run was one. */
const failed = (jobs: JobStatus | null, job: string): JobFailure | undefined =>
  jobs?.failures.find((failure) => failure.job === job);

/**
 * Trakt.
 *
 * The three states that matter are genuinely different questions: no
 * credentials at all (nothing to fix), credentials but no account linked (one
 * click), and a linked account whose token has expired (which looks exactly
 * like "working" everywhere else in the UI, and is the single most common
 * reason history stops arriving).
 */
export function traktHealth(
  status: { connected: boolean; configured: boolean; expiresAt: string | null },
  jobs: JobStatus | null,
  timeAgo: (iso: string) => string,
  now = Date.now()
): SectionHealth {
  if (!status.configured) return { tone: "idle", label: "Not set up" };
  if (!status.connected) return { tone: "warn", label: "Not connected" };

  const expiry = status.expiresAt ? new Date(status.expiresAt).getTime() : null;
  if (expiry !== null && !Number.isNaN(expiry) && expiry <= now) {
    return { tone: "bad", label: "Token expired" };
  }

  // A failing poll outranks a recent success: the last run we recorded may
  // predate the failure, and "4m ago" beside a broken sync is a lie of omission.
  if (failed(jobs, "trakt-history-poll")) return { tone: "bad", label: "Last sync failed" };

  const last = lastRunLabel(jobs, "trakt-history-poll", timeAgo);
  return { tone: "ok", label: last ? `Synced ${last}` : "Connected" };
}

/** Stremio's watched-library sync — same shape, different job. */
export function stremioHealth(
  status: StremioLibraryStatus,
  jobs: JobStatus | null,
  timeAgo: (iso: string) => string
): SectionHealth {
  if (!status.connected) return { tone: "idle", label: "Not connected" };
  if (failed(jobs, "stremio-library-sync")) return { tone: "bad", label: "Last sync failed" };
  const last = lastRunLabel(jobs, "stremio-library-sync", timeAgo);
  return { tone: "ok", label: last ? `Synced ${last}` : "Connected" };
}

/**
 * TMDB is the one key whose absence is a fault rather than a preference —
 * without it there is no artwork, no runtime and no episode list, so the whole
 * app is visibly degraded. The optional keys below get `idle` for the same
 * state.
 */
export function tmdbHealth(status: TmdbStatus): SectionHealth {
  if (!status.configured) return { tone: "warn", label: "No key — artwork is off", short: "No key" };
  return { tone: "ok", label: status.source === "env" ? "Key set (env)" : "Key set", short: "Key set" };
}

/** OMDB, RPDB: extra ratings and prettier posters. Nice to have, never a fault. */
export function optionalKeyHealth(configured: boolean, whenSet = "Key set"): SectionHealth {
  return configured ? { tone: "ok", label: whenSet } : { tone: "idle", label: "Not set" };
}

/** The scheduled jobs as a whole, which is what the Sync Status section is. */
export function jobsHealth(jobs: JobStatus): SectionHealth {
  const count = jobs.failures.length;
  if (count > 0) return { tone: "bad", label: `${count} failing` };
  const overran = (jobs.runs ?? []).filter((run) => run.overran).length;
  if (overran > 0) return { tone: "warn", label: `${overran} overrunning` };
  return { tone: "ok", label: "All healthy" };
}

/**
 * The line under the page title.
 *
 * Counts only what has been set up, because that is the number a reader can
 * act on: "5 of 6 healthy" is a status report, "5 of 18" would be a list of
 * features not in use dressed as a problem. Sources nobody has configured are
 * mentioned separately, in passing, and only when there are any.
 */
export function healthSummary(sections: Record<string, SectionHealth>): string {
  const all = Object.values(sections);
  const live = all.filter((health) => health.tone !== "idle");
  const healthy = live.filter((health) => health.tone === "ok").length;

  if (live.length === 0) {
    return all.length > 0 ? "Nothing connected yet" : "";
  }

  const head = `${healthy} of ${live.length} ${live.length === 1 ? "source" : "sources"} healthy`;
  const idle = all.length - live.length;
  return idle > 0 ? `${head} · ${idle} not set up` : head;
}
