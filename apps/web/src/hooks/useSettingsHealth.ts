import { useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../utils/timeAgo";
import {
  jobsHealth,
  optionalKeyHealth,
  stremioHealth,
  tmdbHealth,
  traktHealth,
  type JobStatus,
  type SectionHealth,
} from "../components/settings/health";

/**
 * The state of every integration the Settings page can report on, keyed by the
 * section id it belongs to.
 *
 * Six requests on mount, all of them a single row or a config read. That is
 * more than the page used to make, and the trade is deliberate: only one
 * section is expanded on a first visit, so the panels that would otherwise
 * answer these questions never run — which is exactly why the answers weren't
 * on screen.
 *
 * Each one is allowed to fail alone, and **a request that failed contributes no
 * entry at all**. This is the difference between "we asked and TMDB has no key"
 * and "we could not ask": both would otherwise render as `No key — artwork is
 * off`, and telling someone their key is missing because a request timed out is
 * worse than telling them nothing. A section with no entry shows no dot, and if
 * every request fails the summary line has nothing to count and says nothing.
 *
 * Deliberately not cached through `useCachedState`. This is health: a value
 * from the last visit is worse than no value at all, because the whole point of
 * the row is to say what is true right now.
 */
export function useSettingsHealth(): Record<string, SectionHealth> {
  const [health, setHealth] = useState<Record<string, SectionHealth>>({});

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // `null` here means "the request failed", which is why every mapper below
      // is guarded rather than being handed the null. `undefined` never occurs.
      const [jobs, trakt, tmdb, omdb, rpdb, stremio] = await Promise.all([
        api.getJobStatus().catch(() => null as JobStatus | null),
        api.getTraktStatus().catch(() => null),
        api.getTmdbStatus().catch(() => null),
        api.getOmdbStatus().catch(() => null),
        api.getRpdbStatus().catch(() => null),
        api.getStremioLibraryStatus().catch(() => null),
      ]);
      if (cancelled) return;

      const next: Record<string, SectionHealth> = {};
      if (tmdb) next.tmdb = tmdbHealth(tmdb);
      if (trakt) next.trakt = traktHealth(trakt, jobs, timeAgo);
      if (stremio) next["stremio-sync"] = stremioHealth(stremio, jobs, timeAgo);
      if (omdb) next.omdb = optionalKeyHealth(omdb.configured);
      if (rpdb) next.rpdb = optionalKeyHealth(rpdb.configured);
      // The two sync rows above still read `jobs` for their timestamps, and
      // cope with it being null — a missing "synced 4m ago" is a smaller loss
      // than a wrong one. Only the row that is *about* the jobs needs them.
      if (jobs) next["job-status"] = jobsHealth(jobs);

      setHealth(next);
    })();

    return () => { cancelled = true; };
  }, []);

  return health;
}
