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
 * on screen. Each one is allowed to fail alone; a section whose status can't be
 * read simply has no dot rather than an alarming one.
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
      const [jobs, trakt, tmdb, omdb, rpdb, stremio] = await Promise.all([
        api.getJobStatus().catch(() => null as JobStatus | null),
        api.getTraktStatus().catch(() => null),
        api.getTmdbStatus().catch(() => null),
        api.getOmdbStatus().catch(() => null),
        api.getRpdbStatus().catch(() => null),
        api.getStremioLibraryStatus().catch(() => null),
      ]);
      if (cancelled) return;

      setHealth({
        tmdb: tmdbHealth(tmdb),
        trakt: traktHealth(trakt, jobs, timeAgo),
        "stremio-sync": stremioHealth(stremio, jobs, timeAgo),
        omdb: optionalKeyHealth(omdb?.configured),
        rpdb: optionalKeyHealth(rpdb?.configured),
        "job-status": jobsHealth(jobs),
      });
    })();

    return () => { cancelled = true; };
  }, []);

  return health;
}
