import { useEffect, useState } from "react";
import {
  Check, Clock, Film, Star, Tv, TvMinimalPlay, X,
} from "lucide-react";
import { api, CatalogList, CheckIn, SearchResult, WatchEvent, WatchProviders } from "../api";
import { WatchDateModal } from "./media-detail/WatchDateModal";
import { CheckInModal } from "./media-detail/CheckInModal";
import { ExternalRatings, StarRating } from "./media-detail/RatingsSection";
import { TagsSection } from "./media-detail/TagsSection";
import { CastSection, CastMember } from "./media-detail/CastSection";
import { SeasonsSection, SeasonInfo } from "./media-detail/SeasonsSection";
import { ProvidersSection } from "./media-detail/ProvidersSection";
import { CheckInBlock } from "./media-detail/CheckInBlock";
import { WatchHistorySection } from "./media-detail/WatchHistorySection";
import { DropShowButton } from "./media-detail/DropShowButton";
import { formatRuntime, statusColor, WatchLogTarget } from "./media-detail/detailPanelUtils";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useScrollLock } from "../hooks/useScrollLock";
import { useEscapeKey } from "../hooks/useEscapeKey";

export { StarRating };

/* ─── Detail Panel ────────────────────────────────────────── */

export function DetailPanel({
  item,
  history,
  historyLoading,
  listMap,
  onClose,
  onShowToast,
  onHistoryChange,
}: {
  item: SearchResult;
  history: WatchEvent[];
  historyLoading: boolean;
  listMap: Map<string, CatalogList>;
  onClose: () => void;
  onShowToast: (message: string, type: "success" | "error" | "info") => void;
  onHistoryChange: (events: WatchEvent[]) => void;
}) {
  const listNames = item.lists.map((id) => listMap.get(id)?.name).filter(Boolean) as string[];
  const dialogRef = useFocusTrap<HTMLDivElement>();

  useScrollLock();
  useEscapeKey(onClose);

  // Cast
  const [cast, setCast] = useState<CastMember[]>([]);
  const [castLoading, setCastLoading] = useState(true);

  // Where to watch
  const [providers, setProviders] = useState<WatchProviders | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);

  // Seasons (series only)
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(item.type === "series");

  // Dropped state (series only)
  const [isDropped, setIsDropped] = useState(false);
  const [droppedLoading, setDroppedLoading] = useState(item.type === "series");

  // Check-in
  const [activeCheckin, setActiveCheckin] = useState<CheckIn | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(true);
  const [showCheckinModal, setShowCheckinModal] = useState(false);

  // Watch log modal
  const [watchTarget, setWatchTarget] = useState<WatchLogTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCast([]); setCastLoading(true);
    setSeasons([]); setSeasonsLoading(item.type === "series");
    setIsDropped(false); setDroppedLoading(item.type === "series");
    setActiveCheckin(null); setCheckinLoading(true);
    setProviders(null); setProvidersLoading(true);

    const { signal } = controller;
    const loads: Promise<void>[] = [
      api.getCast(item.type, item.imdbId, signal).then((r) => {
        if (!cancelled) { setCast(r.cast); setCastLoading(false); }
      }).catch(() => { if (!cancelled) setCastLoading(false); }),
      api.getWatchProviders(item.type, item.imdbId, signal).then((r) => {
        if (!cancelled) { setProviders(r.providers); setProvidersLoading(false); }
      }).catch(() => { if (!cancelled) setProvidersLoading(false); }),
      api.getCheckin(signal).then((r) => {
        if (!cancelled) {
          const c = r.checkin;
          const isThisItem = c && (c.imdbId === item.imdbId || c.seriesImdbId === item.imdbId);
          setActiveCheckin(isThisItem ? c : null);
          setCheckinLoading(false);
        }
      }).catch(() => { if (!cancelled) setCheckinLoading(false); }),
    ];

    if (item.type === "series") {
      loads.push(
        api.getSeasons(item.imdbId, signal).then((r) => {
          if (!cancelled) { setSeasons(r.seasons); setSeasonsLoading(false); }
        }).catch(() => { if (!cancelled) setSeasonsLoading(false); }),
        api.getDropped(item.imdbId, signal).then((r) => {
          if (!cancelled) { setIsDropped(r.dropped); setDroppedLoading(false); }
        }).catch(() => { if (!cancelled) setDroppedLoading(false); }),
      );
    }

    void Promise.all(loads);
    return () => { cancelled = true; controller.abort(); };
  }, [item.imdbId, item.type]);

  const handleDeleteEvent = async (eventId: string) => {
    try {
      await api.deleteWatchEvent(eventId);
      onHistoryChange(history.filter((e) => e.id !== eventId));
    } catch {
      onShowToast("Failed to remove watch event", "error");
    }
  };

  const handleToggleDrop = async () => {
    try {
      if (isDropped) {
        await api.undropShow(item.imdbId);
        setIsDropped(false);
        onShowToast("Removed from dropped shows", "info");
      } else {
        await api.dropShow(item.imdbId);
        setIsDropped(true);
        onShowToast("Marked as dropped", "info");
      }
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
        className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 backdrop-blur-sm sm:p-6"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={item.name}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="relative flex h-full w-full max-h-screen flex-col overflow-hidden shadow-feature sm:h-auto sm:max-h-[85vh] sm:max-w-4xl sm:flex-row sm:rounded-3xl sm:border lg:max-w-5xl"
          style={{ background: "var(--bg-0)", borderColor: "var(--border)" }}
        >
          {/* Close */}
          <button
            type="button" onClick={onClose}
            className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full shadow-lg backdrop-blur transition-colors hover:text-white"
            style={{ background: "color-mix(in srgb, var(--bg-0) 80%, transparent)", color: "var(--bg-2)" }}
            aria-label="Close detail panel"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Poster */}
          <div className="relative z-0 w-full flex-none overflow-hidden aspect-[2/3] max-h-[38vh] sm:aspect-[2/3] sm:max-h-none sm:w-[38%]">
            {item.poster ? (
              <img src={item.poster} alt={item.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(to bottom right, var(--bg-1), var(--bg-0))" }}>
                <Film className="h-20 w-20" style={{ color: "var(--border-strong)" }} />
              </div>
            )}
            <div className="absolute inset-0 sm:hidden" style={{ background: "linear-gradient(to top, var(--bg-0), color-mix(in srgb, var(--bg-0) 20%, transparent), transparent)" }} />
          </div>

          {/* Content */}
          <div className="-mt-10 relative z-20 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-10 sm:mt-0 sm:max-w-2xl sm:p-8">

          {/* Title + badges */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${item.type === "movie" ? "bg-claw-500/90 text-white" : "bg-plum-500/90 text-white"}`}>
                {item.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {item.type === "movie" ? "Movie" : "Series"}
              </span>
              {item.year && <span className="text-sm" style={{ color: "var(--text-mute)" }}>{item.year}</span>}
              {item.certification && (
                <span
                  className="rounded-md border px-2 py-0.5 text-xs font-semibold"
                  style={{ borderColor: "var(--border-strong)", color: "var(--text-dim)" }}
                >
                  {item.certification}
                </span>
              )}
              {item.status && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusColor(item.status)}`}>
                  {item.status}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-2xl font-bold" style={{ color: "var(--text)" }}>{item.name}</h2>

            {/* Meta row: rating, runtime, network, genres */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.rating != null && item.rating > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 ring-1 ring-amber-500/20">
                  <Star className="h-3 w-3 fill-amber-500" />{item.rating.toFixed(1)}
                </span>
              )}
              {item.runtime != null && item.runtime > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                  style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                >
                  <Clock className="h-3 w-3" />{formatRuntime(item.runtime)}
                </span>
              )}
              {item.network && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
                  style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                >
                  <TvMinimalPlay className="h-3 w-3" />{item.network}
                </span>
              )}
              {item.genres.slice(0, 3).map((g) => (
                <span
                  key={g}
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: "var(--surface-strong)", color: "var(--text-dim)" }}
                >
                  {g}
                </span>
              ))}
            </div>
          </div>

          {/* Lists */}
          {listNames.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {listNames.map((name) => (
                <span key={name} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 ring-1 ring-emerald-500/20">
                  <Check className="h-3 w-3" />{name}
                </span>
              ))}
            </div>
          )}

          {/* External Ratings */}
          <ExternalRatings imdbRating={item.imdbRating} rtScore={item.rtScore} mcScore={item.mcScore} />

          {/* User Rating */}
          <StarRating imdbId={item.imdbId} type={item.type} onError={(msg) => onShowToast(msg, "error")} />

          {/* Tags */}
          <TagsSection imdbId={item.imdbId} type={item.type} onError={(msg) => onShowToast(msg, "error")} />

          {/* Check-in / Now Watching */}
          <CheckInBlock
            loading={checkinLoading}
            activeCheckin={activeCheckin}
            isSeries={item.type === "series"}
            onStartCheckin={() => void handleCheckin()}
            onStartSeriesCheckin={() => setShowCheckinModal(true)}
            onCheckout={(logWatch) => void handleCheckout(logWatch)}
          />

          {/* Description */}
          {item.description && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-mute)" }}>Overview</h3>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>{item.description}</p>
            </div>
          )}

          {/* Where to watch */}
          <ProvidersSection providers={providers} loading={providersLoading} />

          {/* Cast */}
          <CastSection cast={cast} loading={castLoading} />

          {/* Season Breakdown (series only) */}
          {item.type === "series" && (
            <SeasonsSection seasons={seasons} loading={seasonsLoading} />
          )}

          {/* Watch History */}
          <WatchHistorySection
            history={history}
            loading={historyLoading}
            onLogWatch={openWatchModal}
            onDeleteEvent={(eventId) => void handleDeleteEvent(eventId)}
          />

          {/* Drop Show (series only) */}
          {item.type === "series" && (
            <DropShowButton
              isDropped={isDropped}
              loading={droppedLoading}
              onToggle={() => void handleToggleDrop()}
            />
          )}
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

/* ─── Hook: open panel with history + meta loading ────────── */

const META_CACHE_TTL_MS = 60_000;
const metaCache = new Map<string, { at: number; meta: Awaited<ReturnType<typeof api.getItemMeta>> }>();

export function useDetailPanel() {
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);

  useEffect(() => {
    if (!selectedItem) return;
    let cancelled = false;
    const controller = new AbortController();
    const active = selectedItem;

    const needsMeta = !active.description && active.genres.length === 0 && active.rating == null;
    const needsOmdb = active.imdbRating === undefined;
    const needsDetail = active.runtime === undefined;

    if (needsMeta || needsOmdb || needsDetail) {
      const cacheKey = `${active.type}:${active.imdbId}`;
      const cached = metaCache.get(cacheKey);
      const applyMeta = (meta: Awaited<ReturnType<typeof api.getItemMeta>>) => {
        setSelectedItem((prev) => {
          if (!prev || prev.imdbId !== active.imdbId) return prev;
          return {
            ...prev,
            description: meta.description ?? prev.description,
            genres: meta.genres.length > 0 ? meta.genres : prev.genres,
            rating: meta.rating ?? prev.rating,
            poster: meta.poster ?? prev.poster,
            imdbRating: meta.imdbRating !== undefined ? meta.imdbRating : prev.imdbRating,
            rtScore: meta.rtScore !== undefined ? meta.rtScore : prev.rtScore,
            mcScore: meta.mcScore !== undefined ? meta.mcScore : prev.mcScore,
            runtime: meta.runtime !== undefined ? meta.runtime : prev.runtime,
            certification: meta.certification !== undefined ? meta.certification : prev.certification,
            status: meta.status !== undefined ? meta.status : prev.status,
            network: meta.network !== undefined ? meta.network : prev.network,
            releaseDate: meta.releaseDate !== undefined ? meta.releaseDate : prev.releaseDate,
          };
        });
      };

      if (cached && Date.now() - cached.at < META_CACHE_TTL_MS) {
        applyMeta(cached.meta);
      } else {
        void (async () => {
          try {
            const meta = await api.getItemMeta(active.type, active.imdbId, controller.signal);
            metaCache.set(cacheKey, { at: Date.now(), meta });
            if (!cancelled) applyMeta(meta);
          } catch { /* best-effort */ }
        })();
      }
    }

    setPanelHistoryLoading(true);
    void (async () => {
      try {
        const history = await api.getWatchHistory(50, 0, { imdbId: active.imdbId, signal: controller.signal });
        if (!cancelled) setPanelHistory(history);
      } catch {
        if (!cancelled) setPanelHistory([]);
      } finally {
        if (!cancelled) setPanelHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedItem]);

  return {
    selectedItem, setSelectedItem,
    panelHistory, setPanelHistory, panelHistoryLoading,
  };
}
