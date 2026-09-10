import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Tv } from "lucide-react";
import { api, EpisodeInfo } from "../../api";
import { ProgressRuler } from "../ProgressRuler";
import { StarPicker } from "../StarPicker";
import { KICKER } from "../typography";

export interface SeasonInfo {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airYear: number | null;
  poster: string | null;
}

const episodeKey = (season: number, episode: number) => `${season}:${episode}`;

export function SeasonsSection({
  imdbId, seasons, loading, onError, onToast,
}: {
  imdbId: string;
  seasons: SeasonInfo[];
  loading: boolean;
  onError?: (message: string) => void;
  onToast?: (message: string, type: "success" | "info") => void;
}) {
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, EpisodeInfo[]>>({});
  const [episodesLoading, setEpisodesLoading] = useState<Record<number, boolean>>({});
  const [pendingEpisode, setPendingEpisode] = useState<Record<string, boolean>>({});
  const [pendingSeason, setPendingSeason] = useState<Record<number, boolean>>({});
  // A season is rated on its own terms — "season 4 was the weak one" is not the
  // same judgement as a score for the whole show, which is why both are kept.
  const [seasonRatings, setSeasonRatings] = useState<Record<number, number>>({});
  const [episodeRatings, setEpisodeRatings] = useState<Record<string, number>>({});
  const [pendingRating, setPendingRating] = useState<Record<string, boolean>>({});
  const imdbIdRef = useRef(imdbId);
  // Whether the watched-episode read has answered. An empty set means two very
  // different things before and after it does — see the auto-expand effect.
  const watchedFetchedRef = useRef(false);

  useEffect(() => {
    imdbIdRef.current = imdbId;
  }, [imdbId]);

  useEffect(() => {
    let cancelled = false;
    setWatched(new Set());
    setExpanded(null);
    setEpisodesBySeason({});
    setEpisodesLoading({});
    setSeasonRatings({});
    setEpisodeRatings({});
    watchedFetchedRef.current = false;
    api.getWatchedEpisodes(imdbId)
      .then((res) => {
        if (cancelled) return;
        // Set before the state, so the auto-expand effect that runs on the
        // resulting render can tell "nothing watched" from "not asked yet".
        watchedFetchedRef.current = true;
        setWatched(new Set(res.episodes.map((e) => episodeKey(e.season, e.episode))));
      })
      .catch(() => {
        // Best-effort — but a failed read is still an answer as far as opening
        // a season goes, or a show whose history won't load never opens one.
        if (!cancelled) watchedFetchedRef.current = true;
      });
    // Every rating for this show in one request — the series' own, its seasons'
    // and its episodes' — rather than one per row as they come into view.
    api.getTitleRatings(imdbId)
      .then((res) => {
        if (cancelled) return;
        // Not `seasons`/`episodes`: `seasons` is a prop of this component, and
        // shadowing it here reads as the season list rather than its ratings.
        const bySeason: Record<number, number> = {};
        const byEpisode: Record<string, number> = {};
        for (const rating of res.ratings) {
          if (rating.type === "season" && rating.season != null) {
            bySeason[rating.season] = rating.rating;
          } else if (rating.type === "episode" && rating.season != null && rating.episode != null) {
            byEpisode[episodeKey(rating.season, rating.episode)] = rating.rating;
          }
        }
        setSeasonRatings(bySeason);
        setEpisodeRatings(byEpisode);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [imdbId]);

  /*
   * How many of each season are watched — from the set fetched for the whole
   * show on mount, not from the episode lists.
   *
   * The distinction is the point: the episode lists arrive one season at a time
   * and only when a season is opened, so counting from them meant a collapsed
   * season could say nothing at all about itself. The watched set is already
   * here, and `season.episodeCount` is the denominator, so every season can
   * carry its own count and its own ruler whether or not it has ever been
   * opened.
   */
  const watchedBySeason = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const key of watched) {
      const season = Number(key.slice(0, key.indexOf(":")));
      if (Number.isFinite(season)) counts[season] = (counts[season] ?? 0) + 1;
    }
    return counts;
  }, [watched]);

  const loadEpisodes = (seasonNumber: number) => {
    if (episodesBySeason[seasonNumber] || episodesLoading[seasonNumber]) return;
    const requestImdbId = imdbId;
    setEpisodesLoading((p) => ({ ...p, [seasonNumber]: true }));
    api.getSeasonEpisodes(imdbId, seasonNumber)
      .then((res) => {
        if (imdbIdRef.current !== requestImdbId) return;
        setEpisodesBySeason((c) => ({ ...c, [seasonNumber]: res.episodes }));
      })
      .catch(() => { /* best-effort */ })
      .finally(() => {
        if (imdbIdRef.current === requestImdbId) setEpisodesLoading((p) => ({ ...p, [seasonNumber]: false }));
      });
  };

  /*
   * Open on the season you are in.
   *
   * Every season used to arrive collapsed, so the panel's most-used surface —
   * the episode you are about to watch — was always one click away behind a
   * disclosure, on a screen you had scrolled to for exactly that. The season in
   * progress is the first that is started and unfinished; failing that, the
   * first that is unstarted (the one you would begin next); failing that, the
   * last, for a show watched to the end.
   *
   * Ref-guarded per title rather than run on every change, so collapsing the
   * season it picked stays collapsed — the next `watched` update must not
   * reopen it under the reader.
   */
  const autoExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (seasons.length === 0 || autoExpandedRef.current === imdbId) return;
    // Nothing to go on yet: `watched` lands a moment after the seasons do, and
    // choosing before it arrives would always pick the first season.
    if (watched.size === 0 && !watchedFetchedRef.current) return;
    autoExpandedRef.current = imdbId;

    const inProgress = seasons.find((s) => {
      const count = watchedBySeason[s.seasonNumber] ?? 0;
      return count > 0 && count < s.episodeCount;
    });
    const unstarted = seasons.find((s) => (watchedBySeason[s.seasonNumber] ?? 0) === 0);
    const open = inProgress ?? unstarted ?? seasons[seasons.length - 1];
    setExpanded(open.seasonNumber);
    loadEpisodes(open.seasonNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadEpisodes is recreated each render and guards its own duplicate fetches
  }, [imdbId, seasons, watched, watchedBySeason]);

  const toggleExpand = (seasonNumber: number) => {
    const next = expanded === seasonNumber ? null : seasonNumber;
    setExpanded(next);
    if (next != null) loadEpisodes(next);
  };

  const toggleEpisode = async (seasonNumber: number, episodeNumber: number) => {
    const k = episodeKey(seasonNumber, episodeNumber);
    if (pendingEpisode[k]) return;
    setPendingEpisode((p) => ({ ...p, [k]: true }));
    const isWatched = watched.has(k);
    try {
      if (isWatched) {
        await api.unmarkEpisodeWatched(imdbId, seasonNumber, episodeNumber);
        setWatched((prev) => { const next = new Set(prev); next.delete(k); return next; });
      } else {
        await api.markEpisodeWatched(imdbId, seasonNumber, episodeNumber);
        setWatched((prev) => new Set(prev).add(k));
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to update episode");
    } finally {
      setPendingEpisode((p) => ({ ...p, [k]: false }));
    }
  };

  // Picking the rating already saved clears it, the same gesture the detail
  // panel's stars use.
  const rate = async (
    key: string,
    current: number | undefined,
    value: number,
    save: () => Promise<void>,
    clear: () => Promise<void>,
    apply: (next: number | null) => void
  ) => {
    if (pendingRating[key]) return;
    const requestImdbId = imdbId;
    setPendingRating((p) => ({ ...p, [key]: true }));
    try {
      if (current === value) {
        await clear();
        if (imdbIdRef.current === requestImdbId) apply(null);
      } else {
        await save();
        if (imdbIdRef.current === requestImdbId) apply(value);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to save rating");
    } finally {
      setPendingRating((p) => ({ ...p, [key]: false }));
    }
  };

  const rateSeason = (seasonNumber: number, value: number) =>
    rate(
      `s${seasonNumber}`,
      seasonRatings[seasonNumber],
      value,
      () => api.setRating(imdbId, "season", value, { season: seasonNumber }).then(() => undefined),
      () => api.deleteRating("season", imdbId, { season: seasonNumber }),
      (next) =>
        setSeasonRatings((prev) => {
          const updated = { ...prev };
          if (next === null) delete updated[seasonNumber];
          else updated[seasonNumber] = next;
          return updated;
        })
    );

  const rateEpisode = (seasonNumber: number, episodeNumber: number, value: number) => {
    const k = episodeKey(seasonNumber, episodeNumber);
    return rate(
      `e${k}`,
      episodeRatings[k],
      value,
      () =>
        api
          .setRating(imdbId, "episode", value, { season: seasonNumber, episode: episodeNumber })
          .then(() => undefined),
      () => api.deleteRating("episode", imdbId, { season: seasonNumber, episode: episodeNumber }),
      (next) =>
        setEpisodeRatings((prev) => {
          const updated = { ...prev };
          if (next === null) delete updated[k];
          else updated[k] = next;
          return updated;
        })
    );
  };

  const markSeasonWatched = async (season: SeasonInfo) => {
    if (pendingSeason[season.seasonNumber]) return;
    const requestImdbId = imdbId;
    setPendingSeason((p) => ({ ...p, [season.seasonNumber]: true }));
    try {
      let episodes = episodesBySeason[season.seasonNumber];
      if (!episodes) {
        const res = await api.getSeasonEpisodes(imdbId, season.seasonNumber);
        if (imdbIdRef.current !== requestImdbId) return;
        episodes = res.episodes;
        setEpisodesBySeason((c) => ({ ...c, [season.seasonNumber]: episodes! }));
      }
      const episodeNumbers = episodes.map((e) => e.episodeNumber);
      const res = await api.markSeasonWatched(imdbId, season.seasonNumber, episodeNumbers);
      if (imdbIdRef.current !== requestImdbId) return;
      setWatched((prev) => {
        const next = new Set(prev);
        for (const n of episodeNumbers) next.add(episodeKey(season.seasonNumber, n));
        return next;
      });
      onToast?.(
        res.marked > 0 ? `Marked ${res.marked} episode${res.marked === 1 ? "" : "s"} watched` : "Season already watched",
        "success"
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to mark season watched");
    } finally {
      setPendingSeason((p) => ({ ...p, [season.seasonNumber]: false }));
    }
  };

  if (loading) {
    return (
      <div>
        <h3 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>Seasons</h3>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-11 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (seasons.length === 0) return null;

  return (
    <div>
      <h3 className={`mb-3 flex items-center gap-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>
        <Tv className="h-3.5 w-3.5" /> Seasons
      </h3>
      <div className="space-y-2">
        {seasons.map((s) => {
          const isExpanded = expanded === s.seasonNumber;
          const episodes = episodesBySeason[s.seasonNumber];
          const watchedCount = watchedBySeason[s.seasonNumber] ?? 0;
          const currentEpisode = episodes?.find(
            (ep) => !watched.has(episodeKey(s.seasonNumber, ep.episodeNumber))
          )?.episodeNumber;

          return (
            // A grouped inset list per season — the group carries the fill and
            // the radius, and the episodes inside it are separated by hairlines
            // that start past the check circle rather than boxed each in a
            // border of their own. See `.list-group` in index.css.
            <div key={s.seasonNumber} className="list-group">
              {/* Wraps because the star picker is 240px wide — the width ten
                  24px pointer targets need — which a narrow panel can't spare
                  beside a season name and a "Mark watched" button. */}
              <div className="px-3.5 pb-3 pt-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(s.seasonNumber)}
                    className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} ${s.name}`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 flex-none self-center" style={{ color: "var(--text-mute)" }} />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 flex-none self-center" style={{ color: "var(--text-mute)" }} />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[1.0625rem] font-semibold" style={{ color: "var(--text)" }}>
                      {s.name}
                    </span>
                    {/* The count climbs as episodes are ticked off under it —
                        tabular figures keep the row still while it does. */}
                    <span className="flex-none text-[0.8125rem] tabular-nums" style={{ color: "var(--text-dim)" }}>
                      {watchedCount} of {s.episodeCount}
                      {s.airYear ? ` · ${s.airYear}` : ""}
                    </span>
                  </button>
                </div>

                {/* One tick per episode, at the weight a detail screen gives a
                    ruler that is the subject of its section rather than a
                    caption under a title. The row above writes the same count
                    out in words, so this is decorative — announcing "4 of 10"
                    twice in two wordings is worse than announcing it once. */}
                <ProgressRuler
                  value={watchedCount}
                  total={s.episodeCount}
                  discrete
                  size="md"
                  decorative
                  className="mt-2.5"
                />

                {/*
                  * The season's own controls, only while it is open.
                  *
                  * The star picker is 240px wide — the width ten 24px pointer
                  * targets need — so on a phone it and the "Mark watched"
                  * button each wrapped onto a line of their own, and a
                  * *collapsed* season was three rows tall. A show with five of
                  * them was a screen of controls for seasons nobody had asked
                  * to see. Closed, a season is now its name, its count and its
                  * ticks; opening one is what asks for the rest.
                  */}
                {isExpanded && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StarPicker
                      value={seasonRatings[s.seasonNumber] ?? null}
                      onRate={(value) => void rateSeason(s.seasonNumber, value)}
                      disabled={pendingRating[`s${s.seasonNumber}`]}
                      size="sm"
                      subject={s.name}
                    />
                    <button
                      type="button"
                      onClick={() => void markSeasonWatched(s)}
                      disabled={pendingSeason[s.seasonNumber]}
                      className="btn-tonal btn-xs flex-none"
                    >
                      Mark watched
                    </button>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {episodesLoading[s.seasonNumber] ? (
                    <div className="space-y-1.5 p-2">
                      {[1, 2, 3].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
                    </div>
                  ) : (episodes ?? []).length === 0 ? (
                    <p className="p-3 text-center text-xs" style={{ color: "var(--text-mute)" }}>No episode data</p>
                  ) : (
                    episodes!.map((ep) => {
                      const k = episodeKey(s.seasonNumber, ep.episodeNumber);
                      const isWatched = watched.has(k);
                      // The one you are up to: the first unwatched episode of
                      // the season. It is the row the screen was opened for,
                      // and without it a part-watched season is a list of
                      // twenty rows in two states with nothing saying where you
                      // stopped.
                      const isCurrent = !isWatched && ep.episodeNumber === currentEpisode;
                      return (
                        /*
                          * The platform's checklist row: the number leads, the
                          * name and its facts take the middle, and the control
                          * that changes anything is the circle on the trailing
                          * edge.
                          *
                          * The whole row used to be the watched toggle, with
                          * the circle at its head — so the thing you read and
                          * the thing you pressed were the same 300px target,
                          * and the row's own metadata had to sit outside the
                          * button that contained most of it. A row, not one big
                          * button: the episode's stars are buttons of their own
                          * and cannot be nested inside another.
                          */
                        <div
                          key={ep.episodeNumber}
                          className="list-row flex w-full items-center gap-3 px-4 py-2.5"
                          // Past the number column and its gap, so the hairline
                          // starts under the episode's name rather than under
                          // the figure beside it.
                          style={{ "--list-inset": "2.75rem" } as React.CSSProperties}
                        >
                          <span
                            className={`w-5 flex-none text-[0.9375rem] tabular-nums ${isCurrent ? "font-semibold" : ""}`}
                            style={{
                              color: isCurrent
                                ? "rgb(var(--accent-rgb))"
                                : isWatched
                                  ? "var(--text-mute)"
                                  : "var(--text-dim)",
                            }}
                          >
                            {ep.episodeNumber}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-[0.9375rem] ${isCurrent ? "font-semibold" : ""}`}
                              style={{ color: isWatched ? "var(--text-mute)" : "var(--text)" }}
                            >
                              {ep.name}
                            </p>
                            {(ep.runtime || ep.airDate) && (
                              <p className="mt-0.5 truncate text-[0.8125rem]" style={{ color: "var(--text-mute)" }}>
                                {[
                                  ep.runtime ? `${ep.runtime} min` : null,
                                  ep.airDate
                                    ? new Date(ep.airDate).toLocaleDateString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        year: "numeric",
                                      })
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                            {/*
                              * Only on an episode you have seen.
                              *
                              * The picker is ten pointer targets and 240px
                              * wide, so on a phone it wrapped onto a line of
                              * its own and every row — watched or not — was
                              * twice as tall as the design's. Rating an episode
                              * you have not watched is not a thing anyone does,
                              * so the rows that don't need it don't pay for it.
                              */}
                            {isWatched && (
                              <StarPicker
                                value={episodeRatings[k] ?? null}
                                onRate={(value) => void rateEpisode(s.seasonNumber, ep.episodeNumber, value)}
                                disabled={pendingRating[`e${k}`]}
                                size="sm"
                                subject={ep.name}
                              />
                            )}
                          </div>

                          {/* Filled when watched, an open ring when not — the
                              two states of a checklist row on the platform.
                              `ring-inset` so the ring is the edge of the circle
                              rather than a halo around it, which at 20px is
                              most of the circle. `tap-target` because 20px is
                              well under the 44px SC 2.5.5 asks for, and the
                              circle is deliberately not growing to meet it. */}
                          <button
                            type="button"
                            onClick={() => void toggleEpisode(s.seasonNumber, ep.episodeNumber)}
                            disabled={pendingEpisode[k]}
                            className={`tap-target flex h-5 w-5 flex-none items-center justify-center rounded-full transition-opacity hover:opacity-75 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset ${
                              isWatched ? "" : "ring-[1.5px] ring-current ring-inset"
                            }`}
                            style={
                              isWatched
                                ? { background: "rgb(var(--accent-rgb))" }
                                : { color: "var(--text-mute)" }
                            }
                            aria-pressed={isWatched}
                            aria-label={`${isWatched ? "Unmark" : "Mark"} ${ep.name} watched`}
                          >
                            {isWatched && <Check className="h-3 w-3 text-claw-on" strokeWidth={3} />}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
