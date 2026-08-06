import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Tv } from "lucide-react";
import { api, EpisodeInfo } from "../../api";
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
    api.getWatchedEpisodes(imdbId)
      .then((res) => {
        if (!cancelled) setWatched(new Set(res.episodes.map((e) => episodeKey(e.season, e.episode))));
      })
      .catch(() => { /* best-effort */ });
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
          const watchedCount = episodes
            ? episodes.filter((e) => watched.has(episodeKey(s.seasonNumber, e.episodeNumber))).length
            : null;

          return (
            <div key={s.seasonNumber} className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
              {/* Wraps because the star picker is 240px wide — the width ten
                  24px pointer targets need — which a narrow panel can't spare
                  beside a season name and a "Mark watched" button. */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5" style={{ background: "var(--surface)" }}>
                <button
                  type="button"
                  onClick={() => toggleExpand(s.seasonNumber)}
                  className="flex min-w-40 flex-1 items-center gap-2.5 text-left"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${s.name}`}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 flex-none" style={{ color: "var(--text-mute)" }} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 flex-none" style={{ color: "var(--text-mute)" }} />
                  )}
                  <div
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-xs font-bold"
                    style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                  >
                    {s.seasonNumber}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>{s.name}</p>
                    {/* The watched count climbs as episodes are ticked off
                        under it — tabular figures keep the row still. */}
                    <p className="text-2xs tabular-nums" style={{ color: "var(--text-mute)" }}>
                      {watchedCount != null ? `${watchedCount}/${s.episodeCount} watched` : `${s.episodeCount} eps`}
                      {s.airYear ? ` · ${s.airYear}` : ""}
                    </p>
                  </div>
                </button>
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

              {isExpanded && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {episodesLoading[s.seasonNumber] ? (
                    <div className="space-y-1.5 p-2">
                      {[1, 2, 3].map((i) => <div key={i} className="skeleton h-9 rounded-lg" />)}
                    </div>
                  ) : (episodes ?? []).length === 0 ? (
                    <p className="p-3 text-center text-xs" style={{ color: "var(--text-mute)" }}>No episode data</p>
                  ) : (
                    episodes!.map((ep, i) => {
                      const k = episodeKey(s.seasonNumber, ep.episodeNumber);
                      const isWatched = watched.has(k);
                      return (
                        // A row, not one big button: the episode's stars are
                        // buttons of their own and can't be nested inside the
                        // watched toggle.
                        <div
                          key={ep.episodeNumber}
                          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                          style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}
                        >
                          <button
                            type="button"
                            onClick={() => void toggleEpisode(s.seasonNumber, ep.episodeNumber)}
                            disabled={pendingEpisode[k]}
                            className="flex min-w-40 flex-1 items-center gap-3 rounded-lg text-left transition-opacity hover:opacity-75 disabled:opacity-50"
                            aria-pressed={isWatched}
                            aria-label={`${isWatched ? "Unmark" : "Mark"} ${ep.name} watched`}
                          >
                            <span
                              className="flex h-5 w-5 flex-none items-center justify-center rounded-full ring-1"
                              style={isWatched
                                ? { background: "rgb(var(--accent-rgb))", borderColor: "transparent" }
                                : { borderColor: "var(--border-strong)" }}
                            >
                              {isWatched && <Check className="h-3 w-3 text-claw-on" />}
                            </span>
                            <span className="w-9 flex-none text-2xs font-semibold" style={{ color: "var(--text-mute)" }}>
                              E{String(ep.episodeNumber).padStart(2, "0")}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs" style={{ color: isWatched ? "var(--text-mute)" : "var(--text)" }}>
                              {ep.name}
                            </span>
                          </button>
                          {ep.airDate && (
                            <time
                              dateTime={ep.airDate}
                              className="hidden flex-none text-2xs sm:block"
                              style={{ color: "var(--text-mute)" }}
                            >
                              {new Date(ep.airDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            </time>
                          )}
                          <StarPicker
                            value={episodeRatings[k] ?? null}
                            onRate={(value) => void rateEpisode(s.seasonNumber, ep.episodeNumber, value)}
                            disabled={pendingRating[`e${k}`]}
                            size="sm"
                            subject={ep.name}
                          />
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
