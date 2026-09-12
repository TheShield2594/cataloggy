import { useEffect, useRef, useState } from "react";
import {
  Check, Film, Play, Star, X,
} from "lucide-react";
import { api, type CheckIn, OfflineWriteQueuedError, type SearchResult, type TrendingMeta, type WatchEvent, type WatchProviders } from "../../api";
import { WatchDateModal } from "./WatchDateModal";
import { CheckInModal } from "./CheckInModal";
import { ExternalLinks, ExternalRatings, StarRating } from "./RatingsSection";
import { ListsSection } from "./ListsSection";
import { TagsSection } from "./TagsSection";
import { CastSection, type CastMember } from "./CastSection";
import { SeasonsSection, type SeasonInfo } from "./SeasonsSection";
import { ProvidersSection } from "./ProvidersSection";
import { CheckInBlock } from "./CheckInBlock";
import { WatchHistorySection } from "./WatchHistorySection";
import { DropShowButton } from "./DropShowButton";
import { RecommendationsSection } from "./RecommendationsSection";
import { buildMetaLine, formatRuntime, nextEpisodeUp, statusColor, type WatchLogTarget } from "./detailPanelUtils";
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

  // Following a recommendation swaps the `item` prop on this same instance, so
  // nothing about the panel resets: the scroll container keeps the offset it had,
  // and the recommendations rail is the last thing in it. Choosing a title from
  // the bottom of one panel dropped you at the bottom of the next one, past its
  // poster, its overview and every control on it.
  //
  // Handled here rather than with a `key` at the six call sites: remounting would
  // replay the entrance animation over a panel that is meant to read as one
  // surface replacing another, and would cycle useScrollLock's refcount through
  // zero, which restores the body's scroll position on the way past.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Assigned rather than scrollTo(): the jump should be instant, and the panel
    // underneath may be mid-`scroll-behavior: smooth`.
    if (contentRef.current) contentRef.current.scrollTop = 0;
    // The trap's own initial focus runs on mount, which this isn't. Without
    // this, focus stays on the recommendation tile that has just been replaced
    // by a different title's content.
    dialogRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dialogRef is a stable ref from useFocusTrap
  }, [item.imdbId, item.type]);

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
  /*
   * The facts under the title, and the two values that used to be chips above
   * them.
   *
   * The runtime was a pill with a clock in it and the score a pill with a star,
   * on their own row between the title and the metadata — two more boxes on a
   * header the last redesign had already spent a paragraph cutting boxes from.
   * A runtime is the same kind of fact as a year, so it joins the run; the
   * score is a judgement rather than a fact, so it stays in the row but keeps
   * its colour and its star. Neither loses its place as the thing the panel is
   * usually opened to check — the row is directly under the title.
   */
  const factLine = [
    ...buildMetaLine(item),
    ...(hasRuntime ? [formatRuntime(item.runtime!)] : []),
  ];
  // Key art if the record carries it, the poster cropped to the frame if not.
  // See the hero's own note.
  const heroArt = item.background ?? item.poster ?? null;
  /*
   * Whether the hero is showing a stand-in rather than key art.
   *
   * A still is meant to fill the frame — cropping one to 16:9 is what it was
   * shot for. A poster is not: `object-cover` on a 2:3 image in a landscape
   * frame keeps its middle third, which for most posters is an actor's torso
   * and no title. So the fallback is contained inside the frame at its own
   * ratio, with the blurred copy behind it filling the sides — while real key
   * art still goes edge to edge.
   */
  const heroArtIsPoster = !item.background && !!item.poster;

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
    try {
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
    } catch (err) {
      // The service worker has it and will send it (see sw.js). Rethrowing here
      // would leave the modal open under a red "failed" — for a watch that is
      // saved, and that the row below cannot show yet only because the event has
      // no server-minted id until it lands.
      if (!(err instanceof OfflineWriteQueuedError)) throw err;
      onShowToast(err.message, "info");
      return;
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

  /*
   * What the primary action means, computed once so the button's label and the
   * modal it opens cannot name two different episodes. See `nextEpisodeUp`.
   *
   * Gated on both of its inputs having arrived. `history` and `seasons` are
   * empty while their requests are in flight, and `nextEpisodeUp` cannot tell
   * "this show has never been watched" from "we have not been told yet" — so
   * for the first moment of every series the button read `Continue · S1 E1`,
   * and pressing it in that moment opened the log modal on episode one of a
   * show you are forty episodes into. A default that wrong is worse than a
   * disabled button, because the modal accepts it.
   *
   * A film has nothing to wait for: its target is the film.
   */
  const progressionReady = item.type === "movie" || (!historyLoading && !detailLoading);
  const nextUp = item.type === "series" && progressionReady ? nextEpisodeUp(history, seasons) : null;

  const openWatchModal = () => {
    if (!progressionReady) return;
    if (item.type === "movie" || !nextUp) {
      setWatchTarget({ kind: "movie", imdbId: item.imdbId, releaseDate: item.releaseDate });
    } else {
      setWatchTarget({ kind: "episode", seriesImdbId: item.imdbId, season: nextUp.season, episode: nextUp.episode });
    }
  };

  /*
   * Check-in, for the callers that cannot wait on it.
   *
   * `handleCheckin` deliberately does not catch: `CheckInModal` awaits it and
   * keeps itself open with its own error when it rejects. The two callers that
   * fire and forget — the button in the hero and `CheckInBlock` — were dropping
   * that rejection on the floor with `void`, so a failed check-in was a button
   * that did nothing at all.
   */
  const checkInAndReport = (season?: number, episode?: number) => {
    void handleCheckin(season, episode).catch(() => onShowToast("Could not check in", "error"));
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
          // A column at every size now, where it used to become a side-by-side
          // row on `sm`. The hero *is* the top of this screen — a full-bleed
          // still with the title over it, the way a product page opens on the
          // platform — and a poster in a 38% left column is a different design
          // that happens to contain the same facts.
          className={`glass-surface overlay-panel relative flex h-full w-full max-h-screen flex-col overflow-hidden shadow-e3 sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-3xl sm:border ${exiting ? "overlay-exit" : ""}`}
          style={{ background: "var(--bg-0)", borderColor: "var(--border)" }}
        >
          {/* Close — the 36px glass circle the platform floats over artwork,
              rather than a chip borrowed from the page behind it. Hovers to
              --text, not white: the light theme's circle is translucent, and
              white-on-it made the X disappear under the pointer on the one
              theme where it mattered most. */}
          <button
            type="button" onClick={requestClose}
            className="tap-target bar-glass absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:text-[var(--text)]"
            style={{ color: "var(--text-dim)" }}
            aria-label="Close detail panel"
          >
            <X className="h-4 w-4" />
          </button>

          {/*
            * The hero.
            *
            * Was a poster: a 2:3 column beside the content on a desktop, and a
            * shallow band with the whole poster letterboxed inside it on a
            * phone. Both were the artwork shown *next to* the title. A product
            * page on the platform opens on the still, full-bleed, with the
            * title set over the bottom of it — the picture is the top of the
            * screen rather than an illustration on it.
            *
            * Key art if the record has it, the poster cropped to the frame if
            * not. A poster in a 16:9 crop is its middle third, which is a worse
            * picture than the still and a much better one than a grey box; the
            * blurred copy behind it fills the width for the many titles whose
            * art is portrait.
            */}
          <div ref={contentRef} className="relative z-20 min-h-0 flex-1 overflow-y-auto">
          {/* Inside the scroller, not pinned above it. A hero that stays put
              spends 42vh of every screen on a picture you have already looked
              at — and the episode list, which is what the rest of the scroll is
              for, would never get more than half the panel. It scrolls away
              like the top of a page, which is what it is. */}
          <div className="relative z-0 h-[42vh] max-h-[26rem] min-h-[15rem] w-full overflow-hidden sm:h-[22rem]">
            {heroArt ? (
              <>
                <img
                  src={heroArt}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
                />
                <img
                  src={heroArt}
                  alt=""
                  aria-hidden="true"
                  className={
                    heroArtIsPoster
                      ? "relative mx-auto h-full w-auto max-w-full object-contain"
                      : "relative h-full w-full object-cover"
                  }
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(to bottom right, var(--bg-1), var(--bg-0))" }}>
                <Film className="h-20 w-20" style={{ color: "var(--border-strong)" }} />
              </div>
            )}
            {/*
              * The scrim fades to --bg-0 rather than to black.
              *
              * The design is drawn on a black page, where a scrim to #000 and a
              * white title are the same decision. This app has five themes, two
              * of which are light, and a hero whose bottom is always black
              * would end in a hard edge against a #f2f2f7 panel — and a white
              * title over it would be the only white text on the screen.
              *
              * Fading to the panel's own background instead means the picture
              * dissolves into the page on every theme, and the title can take
              * --text: by the time it starts, the scrim is near-opaque, so it
              * is reading against the page colour rather than against whatever
              * the artwork happens to be.
              */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--bg-0) 22%, transparent) 0%, transparent 26%, transparent 46%, color-mix(in srgb, var(--bg-0) 86%, transparent) 80%, var(--bg-0) 100%)",
              }}
            />

            <div className="absolute inset-x-5 bottom-0 sm:inset-x-8">
              {/*
                * No "MOVIE"/"SERIES" chip over the artwork.
                *
                * It was the loudest thing in the hero — a filled pill in a
                * colour that means nothing, above the title, saying what the
                * row under the title says quietly and what the rest of the
                * panel makes obvious: a film has a runtime and no seasons, a
                * series has an episode list. It is the same badge the Shelf's
                * grid dropped for the same reason.
                *
                * The status stays. "Returning" and "Ended" are the one thing
                * here a reader cannot infer, and `.status-chip` carries it in
                * words as well as in colour — so it joins the fact row rather
                * than floating above the title on its own.
                */}
              <h2 className={PAGE_TITLE} style={{ color: "var(--text)" }}>{item.name}</h2>

              {/* One line of facts, and the certification as a badge at the end
                  of it — see `buildMetaLine` for why that one leaves the run. */}
              {(factLine.length > 0 || item.certification || hasRating || item.status) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]" style={{ color: "var(--text-dim)" }}>
                  {factLine.map((part, index) => (
                    <span key={part} className="flex items-center gap-2">
                      {index > 0 && <span aria-hidden="true" style={{ color: "var(--text-mute)" }}>·</span>}
                      {part}
                    </span>
                  ))}
                  {/* The score keeps its colour — it is the one value in the
                      row that is a judgement rather than a fact, and it is
                      half of what the panel gets opened to check. */}
                  {hasRating && (
                    <span
                      className="inline-flex items-center gap-1 font-semibold text-warning"
                      title={ratingLabel(item.rating!)}
                    >
                      <Star className="h-3 w-3 fill-warning" />
                      <span className="tabular-nums">{formatRating(item.rating!)}</span>
                      <span className="font-normal tabular-nums" style={{ color: "var(--text-mute)" }}>
                        /{RATING_MAX}
                      </span>
                    </span>
                  )}
                  {item.certification?.trim() && (
                    <span
                      className="rounded-[3px] px-1 text-[0.625rem] font-bold leading-[1.4]"
                      style={{ border: "1px solid var(--border-strong)", color: "var(--text-dim)" }}
                    >
                      {item.certification.trim()}
                    </span>
                  )}
                  {/* No `ring-1` on the chip: .status-chip draws its own
                      hairline from the same token as its text, and a utility
                      ring would outrank it. */}
                  {item.status && (
                    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${statusColor(item.status)}`}>
                      {item.status}
                    </span>
                  )}
                </div>
              )}

              {/* Its own line rather than another segment of the row above: a
                  person is not the same kind of fact as a year or a genre, and
                  it is the one line here that names someone. */}
              {director && (
                <p className="mt-1 truncate text-[0.8125rem]" style={{ color: "var(--text-mute)" }}>
                  {item.type === "movie" ? "Directed by " : "Created by "}
                  <span style={{ color: "var(--text-dim)" }}>{director}</span>
                </p>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6 px-5 pb-10 pt-4 sm:px-8">

          {/*
            * One primary action, and one beside it.
            *
            * The panel's two verbs were buried: "Log a Watch" sat inside the
            * watch-history section near the bottom, and the check-in was a
            * block below the tracking divider. They are what the screen is
            * *for* — a wide filled button and a square secondary is how the
            * platform says so, directly under the title.
            *
            * Two buttons rather than the design's three: it draws a tick and a
            * plus beside the primary, and this app has no third verb that
            * isn't already a control further down. Inventing one to fill the
            * slot would be drawing the design rather than building it.
            */}
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={openWatchModal}
              disabled={!progressionReady}
              className="btn-primary h-[3.125rem] flex-1 rounded-2xl text-[1.0625rem]"
            >
              <Play className="h-4 w-4 translate-x-[1px] fill-current" />
              {/* Named only once the episode is known — see `progressionReady`.
                  "Continue" alone is true while we are still finding out; a
                  number would not be. */}
              {item.type === "movie"
                ? "Log a watch"
                : nextUp
                  ? `Continue · S${nextUp.season} E${nextUp.episode}`
                  : "Continue"}
            </button>
            <button
              type="button"
              onClick={() => (item.type === "series" ? setShowCheckinModal(true) : checkInAndReport())}
              disabled={checkinLoading || !!activeCheckin}
              // Named for what it does rather than for its glyph, and titled as
              // well — it is a 50px square with no label under it.
              aria-label={activeCheckin ? "Already checked in" : `Check in to ${item.name}`}
              title={activeCheckin ? "Already checked in" : "Check in"}
              className="btn-secondary h-[3.125rem] w-[3.125rem] flex-none rounded-2xl px-0"
            >
              <Check className="h-[1.125rem] w-[1.125rem]" />
            </button>
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
            onStartCheckin={() => checkInAndReport()}
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
