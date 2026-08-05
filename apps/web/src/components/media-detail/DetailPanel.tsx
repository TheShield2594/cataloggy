import { useEffect, useRef, useState } from "react";
import {
  Clock, Film, Star, Tv, X,
} from "lucide-react";
import { api, CheckIn, SearchResult, TrendingMeta, WatchEvent, WatchProviders } from "../../api";
import { WatchDateModal } from "./WatchDateModal";
import { CheckInModal } from "./CheckInModal";
import { ExternalLinks, ExternalRatings, StarRating } from "./RatingsSection";
import { ListsSection } from "./ListsSection";
import { TagsSection } from "./TagsSection";
import { CastSection, CastMember } from "./CastSection";
import { SeasonsSection, SeasonInfo } from "./SeasonsSection";
import { ProvidersSection } from "./ProvidersSection";
import { CheckInBlock } from "./CheckInBlock";
import { WatchHistorySection } from "./WatchHistorySection";
import { DropShowButton } from "./DropShowButton";
import { RecommendationsSection } from "./RecommendationsSection";
import { buildMetaLine, formatRuntime, statusColor, WatchLogTarget } from "./detailPanelUtils";
import { formatRating, ratingLabel, RATING_MAX } from "../../utils/rating";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useScrollLock } from "../../hooks/useScrollLock";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useExitAnimation } from "../../hooks/useExitAnimation";
import type { ShowToast } from "../../hooks/useToast";
import { relogWatchEvent } from "../../utils/watchEvents";
import { invalidateDetailBundle, type PanelDetail } from "./useDetailPanel";
import { PAGE_TITLE, KICKER, MICRO_LABEL } from "../typography";

/* ─── Detail Panel ────────────────────────────────────────── */

export function DetailPanel({
  item,
  history,
  historyLoading,
  detail,
  detailLoading,
  onClose,
  onShowToast,
  onHistoryChange,
  onSelectItem,
  staticScrim = false,
}: {
  item: SearchResult;
  history: WatchEvent[];
  historyLoading: boolean;
  /** Cast, providers, recommendations, seasons and dropped state, fetched as one bundle by `useDetailPanel`. */
  detail: PanelDetail | null;
  detailLoading: boolean;
  onClose: () => void;
  onShowToast: ShowToast;
  onHistoryChange: (events: WatchEvent[]) => void;
  onSelectItem: (item: SearchResult) => void;
  /**
   * The command palette opens this panel over a scrim it already has up, and
   * takes the scrim back when the panel closes. Both backdrops are the same
   * `.overlay-scrim`, so holding this one still — no fade in, no fade out —
   * is what makes the swap read as one surface replacing another rather than
   * the whole backdrop blinking.
   */
  staticScrim?: boolean;
}) {
  const dialogRef = useFocusTrap<HTMLDivElement>();
  const { exiting, requestClose, onExitAnimationEnd } = useExitAnimation(onClose);

  // Undo runs from a toast that outlives the interaction that raised it: the
  // panel can have moved on to a recommendation, or the history behind it can
  // have changed. Both handlers read current values rather than the ones closed
  // over at click time.
  const currentImdbIdRef = useRef(item.imdbId);
  currentImdbIdRef.current = item.imdbId;
  const historyRef = useRef(history);
  historyRef.current = history;

  useScrollLock();
  useEscapeKey(requestClose);

  // Cast, providers, recommendations and seasons all arrive together in `detail`
  // — one request made by `useDetailPanel`, rather than the five this component
  // used to fire on mount. They are read straight from the prop; only the
  // dropped flag needs local state, because the button below can change it.
  const cast: CastMember[] = detail?.cast ?? [];
  const director = detail?.director ?? null;
  const providers: WatchProviders | null = detail?.providers ?? null;
  const recommendations: TrendingMeta[] = detail?.recommendations ?? [];
  const seasons: SeasonInfo[] = detail?.seasons ?? [];
  const sectionsLoading = detailLoading;

  // The header's hierarchy — see the note on it below, and on `buildMetaLine`.
  const hasRating = item.rating != null && item.rating > 0;
  const hasRuntime = item.runtime != null && item.runtime > 0;
  const metaLine = buildMetaLine(item);

  // Dropped state (series only) — seeded from the bundle, then owned here, since
  // toggling it has to show immediately rather than wait for a refetch.
  //
  // `null` means "not known yet", which is not the same as "not dropped": a
  // bundle that failed leaves `detail` null with nothing loading, and defaulting
  // to false there would offer to drop a show that is already dropped. The
  // button stays hidden until there is an answer.
  const [isDropped, setIsDropped] = useState<boolean | null>(null);
  useEffect(() => {
    setIsDropped(detail ? detail.dropped : null);
  }, [detail, item.imdbId]);

  // Check-in. Stays a request of its own: it is about the user's current
  // session rather than about this title, and it is what tells the panel
  // whether the thing playing right now is the thing being looked at.
  const [activeCheckin, setActiveCheckin] = useState<CheckIn | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(true);
  const [showCheckinModal, setShowCheckinModal] = useState(false);

  // Watch log modal
  const [watchTarget, setWatchTarget] = useState<WatchLogTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setActiveCheckin(null);
    setCheckinLoading(true);

    void api.getCheckin(controller.signal).then((r) => {
      if (cancelled) return;
      const c = r.checkin;
      const isThisItem = c && (c.imdbId === item.imdbId || c.seriesImdbId === item.imdbId);
      setActiveCheckin(isThisItem ? c : null);
      setCheckinLoading(false);
    }).catch(() => { if (!cancelled) setCheckinLoading(false); });

    return () => { cancelled = true; controller.abort(); };
  }, [item.imdbId, item.type]);

  const handleUndoDeleteEvent = async (event: WatchEvent, imdbId: string) => {
    try {
      const restored = await relogWatchEvent(event);
      // The panel may have followed a recommendation since the toast went up;
      // the re-log is what matters then, and pushing the event into a different
      // title's history would only corrupt what's on screen. A re-log can also
      // fold into an event already listed, so the insert is keyed on id.
      if (currentImdbIdRef.current !== imdbId) return;
      onHistoryChange(
        historyRef.current.some((e) => e.id === restored.id)
          ? historyRef.current
          : [...historyRef.current, restored].sort(
              (a, b) => new Date(b.watchedAt).getTime() - new Date(a.watchedAt).getTime()
            )
      );
    } catch {
      onShowToast("Could not restore watch event", "error");
    }
  };

  const handleDeleteEvent = async (event: WatchEvent) => {
    const imdbId = item.imdbId;
    try {
      await api.deleteWatchEvent(event.id);
      onHistoryChange(history.filter((e) => e.id !== event.id));
      onShowToast("Watch removed", "info", {
        action: { label: "Undo", onAction: () => void handleUndoDeleteEvent(event, imdbId) },
      });
    } catch {
      onShowToast("Failed to remove watch event", "error");
    }
  };

  const handleUndrop = async (imdbId: string) => {
    try {
      await api.undropShow(imdbId);
      if (currentImdbIdRef.current === imdbId) setIsDropped(false);
      invalidateDetailBundle(imdbId);
    } catch {
      onShowToast("Failed to update drop status", "error");
    }
  };

  const handleToggleDrop = async () => {
    const imdbId = item.imdbId;
    try {
      if (isDropped) {
        await api.undropShow(imdbId);
        setIsDropped(false);
        onShowToast("Removed from dropped shows", "info");
      } else {
        await api.dropShow(imdbId);
        setIsDropped(true);
        onShowToast("Marked as dropped", "info", {
          action: { label: "Undo", onAction: () => void handleUndrop(imdbId) },
        });
      }
      // The cached bundle carries the old dropped flag, and it is served for a
      // minute — long enough to reopen this title and see the state you just
      // changed still showing the previous value.
      invalidateDetailBundle(imdbId);
    } catch {
      onShowToast("Failed to update drop status", "error");
    }
  };

  const handleCheckin = async (season?: number, episode?: number) => {
    const runtime = item.runtime ?? undefined;
    const payload = item.type === "movie"
      ? { type: "movie" as const, imdbId: item.imdbId, name: item.name, poster: item.poster ?? undefined, runtime }
      : { type: "episode" as const, imdbId: item.imdbId, seriesImdbId: item.imdbId, name: item.name, poster: item.poster ?? undefined, season, episode, runtime };
    const res = await api.startCheckin(payload);
    setActiveCheckin(res.checkin);
    onShowToast(`Checked in to ${item.name}`, "info");
  };

  const handleCheckout = async (logWatch: boolean) => {
    await api.endCheckin(logWatch);
    setActiveCheckin(null);
    if (logWatch) {
      onShowToast("Watch logged!", "success");
      try {
        const updated = await api.getWatchHistory(50, 0, { imdbId: item.imdbId });
        onHistoryChange(updated);
      } catch { /* best-effort */ }
    } else {
      onShowToast("Checked out", "info");
    }
  };

  const handleLog = async (dateIso: string, episodeInfo?: { season: number; episode: number }, dateUnknown?: boolean) => {
    if (!watchTarget) return;
    if (watchTarget.kind === "movie") {
      await api.logWatch({ type: "movie", imdbId: watchTarget.imdbId, watchedAt: dateIso, dateUnknown });
    } else {
      await api.logWatch({
        type: "episode",
        imdbId: watchTarget.seriesImdbId,
        seriesImdbId: watchTarget.seriesImdbId,
        season: episodeInfo?.season ?? watchTarget.season,
        episode: episodeInfo?.episode ?? watchTarget.episode,
        watchedAt: dateIso,
        dateUnknown,
      });
    }
    onShowToast("Watch logged!", "success");
    // Refresh history via parent
    try {
      const updated = await api.getWatchHistory(50, 0, { imdbId: item.imdbId });
      onHistoryChange(updated);
    } catch { /* best-effort */ }
  };

  const handleSelectRecommendation = (rec: TrendingMeta) => {
    onSelectItem({
      imdbId: rec.id,
      type: rec.type,
      name: rec.name,
      year: rec.year ?? null,
      poster: rec.poster ?? null,
      description: rec.description ?? null,
      genres: rec.genres ?? [],
      rating: rec.rating ?? null,
      inWatchlist: false,
      inCollection: false,
      lists: [],
    });
  };

  const openWatchModal = () => {
    if (item.type === "movie") {
      setWatchTarget({ kind: "movie", imdbId: item.imdbId, releaseDate: item.releaseDate });
    } else {
      // Default to next episode after last watched, or S01E01
      const lastEvent = history.find((e) => e.season != null && e.episode != null);
      let nextSeason = lastEvent?.season ?? 1;
      let nextEpisode = lastEvent ? (lastEvent.episode ?? 0) + 1 : 1;
      if (lastEvent) {
        const currentSeason = seasons.find((s) => s.seasonNumber === lastEvent.season);
        if (currentSeason && (lastEvent.episode ?? 0) >= currentSeason.episodeCount) {
          const upcoming = seasons
            .filter((s) => s.seasonNumber > (lastEvent.season ?? 0) && s.episodeCount > 0)
            .sort((a, b) => a.seasonNumber - b.seasonNumber)[0];
          if (upcoming) {
            nextSeason = upcoming.seasonNumber;
            nextEpisode = 1;
          } else {
            // Fully watched, no further season — don't suggest a nonexistent episode.
            nextSeason = currentSeason.seasonNumber;
            nextEpisode = currentSeason.episodeCount;
          }
        }
      }
      setWatchTarget({ kind: "episode", seriesImdbId: item.imdbId, season: nextSeason, episode: nextEpisode });
    }
  };

  return (
    <>
      <div
        className={`overlay-scrim fixed inset-0 z-50 flex items-center justify-center overflow-hidden sm:p-6 ${staticScrim ? "" : "overlay-fade"} ${exiting ? "overlay-exit" : ""}`}
        onClick={requestClose}
      >
        {item.background && (
          <img
            src={item.background}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 hidden h-full w-full scale-110 object-cover opacity-30 blur-2xl sm:block"
          />
        )}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={item.name}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onAnimationEnd={onExitAnimationEnd}
          className={`glass-surface overlay-panel relative flex h-full w-full max-h-screen flex-col overflow-hidden shadow-e3 sm:h-auto sm:max-h-[85vh] sm:max-w-4xl sm:flex-row sm:rounded-3xl sm:border lg:max-w-5xl ${exiting ? "overlay-exit" : ""}`}
          style={{ background: "var(--bg-0)", borderColor: "var(--border)" }}
        >
          {/* Close */}
          <button
            type="button" onClick={requestClose}
            // Hovers to --text, not white: the light theme's circle is a
            // translucent cream, and white-on-cream made the X disappear under
            // the pointer on the one theme where it mattered most.
            className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full shadow-e2 backdrop-blur transition-colors hover:text-[var(--text)]"
            style={{ background: "color-mix(in srgb, var(--bg-0) 80%, transparent)", color: "var(--text-dim)" }}
            aria-label="Close detail panel"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Poster.
              The declared 2:3 box only holds if nothing else sets the height:
              in the desktop flex row the default `align-items: stretch` sized
              it from the row (388x805, a 0.48 ratio) and `object-cover` took
              ~28% off each side of the artwork, so `self-start` lets the ratio
              apply. On mobile the column is a deliberately shallow band, which
              cropped the poster to a strip through its middle — the whole
              poster is drawn inside the band instead, over a blurred copy of
              itself so the band still fills the width. */}
          <div className="relative z-0 h-[38vh] w-full flex-none overflow-hidden sm:h-auto sm:max-h-[85vh] sm:aspect-[2/3] sm:w-[38%] sm:self-start">
            {item.poster ? (
              <>
                <img
                  src={item.poster}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                />
                <img
                  src={item.poster}
                  alt={item.name}
                  className="relative mx-auto h-full w-auto max-w-full object-contain"
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(to bottom right, var(--bg-1), var(--bg-0))" }}>
                <Film className="h-20 w-20" style={{ color: "var(--border-strong)" }} />
              </div>
            )}
            <div className="absolute inset-0 sm:hidden" style={{ background: "linear-gradient(to top, var(--bg-0), color-mix(in srgb, var(--bg-0) 20%, transparent), transparent)" }} />
          </div>

          {/* Content */}
          <div className="-mt-10 relative z-20 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-10 sm:mt-0 sm:max-w-2xl sm:p-8">

          {/* Title + badges

              The header used to ask the reader to parse nine chips in five
              colour treatments before reaching the overview — type, year,
              certification and status on one row; score, runtime, network and
              up to three genres on the next — with nothing in the arrangement
              saying which value mattered, and a lone genre chip stranded on its
              own line once the row wrapped on mobile.

              Two chips carry what a title *is* (its medium, and whether it is
              still running). Two values are promoted because they are what the
              panel is usually opened to check: the score and the runtime.
              Everything else is a fact about the title rather than a signal, so
              it reads as one dim line of text that wraps like text. */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${item.type === "movie" ? "bg-claw-500 text-claw-on" : "bg-plum-500/90 text-white"}`}>
                {item.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {item.type === "movie" ? "Movie" : "Series"}
              </span>
              {/* No `ring-1` on the chip: .status-chip draws its own hairline
                  from the same token as its text, and a utility ring would
                  outrank it. */}
              {item.status && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColor(item.status)}`}>
                  {item.status}
                </span>
              )}
            </div>
            <h2 className={`mt-3 ${PAGE_TITLE}`} style={{ color: "var(--text)" }}>{item.name}</h2>

            {/* The two promoted values */}
            {(hasRating || hasRuntime) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {hasRating && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-sm font-semibold text-amber-600 ring-1 ring-amber-500/20" title={ratingLabel(item.rating!)}>
                    <Star className="h-3.5 w-3.5 fill-amber-500" />{formatRating(item.rating!)}
                    <span className="text-xs font-normal" style={{ color: "var(--text-mute)" }}>/{RATING_MAX}</span>
                  </span>
                )}
                {hasRuntime && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm"
                    style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                  >
                    <Clock className="h-3.5 w-3.5" />{formatRuntime(item.runtime!)}
                  </span>
                )}
              </div>
            )}

            {/* Everything demoted, as one line that wraps like prose */}
            {metaLine.length > 0 && (
              <p className="mt-2 text-sm" style={{ color: "var(--text-mute)" }}>
                {metaLine.join(" · ")}
              </p>
            )}

            {director && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--text-dim)" }}>
                {item.type === "movie" ? "Directed by " : "Created by "}
                <span style={{ color: "var(--text)" }}>{director}</span>
              </p>
            )}
          </div>

          {/* ─── What it is ───────────────────────────────────────
              Opening a title you don't recognise has to answer "what is
              this?" before it offers anywhere to file it, so everything
              descriptive leads and the tracking controls follow. */}

          {/* Description */}
          {item.description && (
            <div>
              <h3 className={`mb-2 ${KICKER}`} style={{ color: "var(--text-mute)" }}>Overview</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>{item.description}</p>
            </div>
          )}

          {/* External Ratings */}
          <ExternalRatings imdbId={item.imdbId} imdbRating={item.imdbRating} rtScore={item.rtScore} mcScore={item.mcScore} loading={sectionsLoading} />

          {/* External Links */}
          <ExternalLinks tmdbId={item.tmdbId} type={item.type} />

          {/* Where to watch */}
          <ProvidersSection providers={providers} loading={sectionsLoading} />

          {/* Cast */}
          <CastSection cast={cast} loading={sectionsLoading} />

          {/* ─── Your tracking ──────────────────────────────────── */}
          <div className="flex items-center gap-3 pt-1">
            <span className={MICRO_LABEL} style={{ color: "var(--text-mute)" }}>
              Your tracking
            </span>
            <span aria-hidden="true" className="h-px flex-1" style={{ background: "var(--border)" }} />
          </div>

          {/* Check-in / Now Watching */}
          <CheckInBlock
            loading={checkinLoading}
            activeCheckin={activeCheckin}
            isSeries={item.type === "series"}
            onStartCheckin={() => void handleCheckin()}
            onStartSeriesCheckin={() => setShowCheckinModal(true)}
            onCheckout={(logWatch) => void handleCheckout(logWatch)}
          />

          {/* Lists */}
          <ListsSection
            imdbId={item.imdbId}
            type={item.type}
            name={item.name}
            initialListIds={item.lists}
            onError={(msg) => onShowToast(msg, "error")}
            onToast={(msg, type) => onShowToast(msg, type)}
          />

          {/* User Rating */}
          <StarRating imdbId={item.imdbId} type={item.type} onError={(msg) => onShowToast(msg, "error")} />

          {/* Tags */}
          <TagsSection imdbId={item.imdbId} type={item.type} onError={(msg) => onShowToast(msg, "error")} />

          {/* Drop (series only) — a tracking change, so it lives with the rest
              of them rather than as a footnote after every other section. */}
          {item.type === "series" && (
            <DropShowButton
              isDropped={isDropped ?? false}
              // Hidden until the dropped state is actually known, which covers
              // both "still loading" and "the bundle failed".
              loading={sectionsLoading || isDropped === null}
              onToggle={() => void handleToggleDrop()}
            />
          )}

          {/* Season Breakdown (series only) */}
          {item.type === "series" && (
            <SeasonsSection
              imdbId={item.imdbId}
              seasons={seasons}
              loading={sectionsLoading}
              onError={(msg) => onShowToast(msg, "error")}
              onToast={(msg, type) => onShowToast(msg, type)}
            />
          )}

          {/* Watch History */}
          <WatchHistorySection
            history={history}
            loading={historyLoading}
            onLogWatch={openWatchModal}
            onDeleteEvent={(event) => void handleDeleteEvent(event)}
          />

          {/* More Like This */}
          <RecommendationsSection
            items={recommendations}
            loading={sectionsLoading}
            onSelect={handleSelectRecommendation}
          />

          </div>
        </div>
      </div>

      {/* Watch Date Modal */}
      {watchTarget && (
        <WatchDateModal
          target={watchTarget}
          onLog={handleLog}
          onClose={() => setWatchTarget(null)}
        />
      )}

      {/* Check-in Modal (series only) */}
      {showCheckinModal && item.type === "series" && (
        <CheckInModal
          seriesName={item.name}
          defaultSeason={history.find((e) => e.season != null)?.season ?? 1}
          defaultEpisode={(history.find((e) => e.episode != null)?.episode ?? 0) + 1}
          onCheckIn={async (season, episode) => { await handleCheckin(season, episode); }}
          onClose={() => setShowCheckinModal(false)}
        />
      )}
    </>
  );
}
