import { useCallback, useEffect, useState } from "react";
import {
  Calendar, Check, ChevronRight, Clock, Film, Radio, Star, Trash2, Tv, TvMinimalPlay, User, X,
} from "lucide-react";
import { api, ApiError, CatalogList, CheckIn, MediaType, SearchResult, WatchEvent } from "../api";

/* ─── Rating Source Logos ─────────────────────────────────── */

function ImdbLogo() {
  return (
    <span
      className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
      style={{ background: "#F5C518", fontFamily: "Arial Black, Arial, sans-serif" }}
    >
      IMDb
    </span>
  );
}

function RtLogo({ score }: { score: number }) {
  const isFresh = score >= 60;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Rotten Tomatoes">
      {isFresh ? (
        <>
          <circle cx="9" cy="11" r="6.5" fill="#FA320A" />
          <ellipse cx="9" cy="4.5" rx="1" ry="2" fill="#00C300" transform="rotate(-15 9 4.5)" />
          <ellipse cx="11" cy="3.5" rx="0.8" ry="1.8" fill="#00C300" transform="rotate(15 11 3.5)" />
          <ellipse cx="7" cy="3.5" rx="0.8" ry="1.8" fill="#00C300" transform="rotate(-15 7 3.5)" />
          <circle cx="7" cy="9" r="1.5" fill="#FA6040" opacity="0.5" />
          <circle cx="11.5" cy="11.5" r="1" fill="#FA6040" opacity="0.4" />
        </>
      ) : (
        <>
          <circle cx="9" cy="10" r="6" fill="#69BE28" opacity="0.9" />
          <path d="M6 7 L12 13 M12 7 L6 13" stroke="#3a7a00" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="10" r="3" fill="#69BE28" />
        </>
      )}
    </svg>
  );
}

function McIcon({ score }: { score: number }) {
  const color = score >= 61 ? "#6ac045" : score >= 40 ? "#ffbd3f" : "#ff4444";
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Metacritic">
      <rect width="18" height="18" rx="3" fill={color} />
      <text x="9" y="13" textAnchor="middle" fontSize="11" fontWeight="900" fill="white" fontFamily="Arial Black, Arial, sans-serif">M</text>
    </svg>
  );
}

/* ─── Helpers ─────────────────────────────────────────────── */

function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("return") || s.includes("ongoing")) return "text-green-400 bg-green-500/10 ring-green-500/20";
  if (s.includes("ended") || s.includes("cancel")) return "text-rose-400 bg-rose-500/10 ring-rose-500/20";
  if (s.includes("production") || s.includes("planned")) return "text-amber-400 bg-amber-500/10 ring-amber-500/20";
  return "text-slate-400 bg-slate-800/60 ring-slate-700/40";
}

/* ─── Watch Date Modal ────────────────────────────────────── */

type WatchLogTarget =
  | { kind: "movie"; imdbId: string; releaseDate: string | null | undefined }
  | { kind: "episode"; seriesImdbId: string; season: number; episode: number };

function WatchDateModal({
  target,
  onLog,
  onClose,
}: {
  target: WatchLogTarget;
  onLog: (date: string, episode?: { season: number; episode: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"quick" | "custom">("quick");
  const [customDate, setCustomDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For episode mode: let user pick season+episode
  const [season, setSeason] = useState(target.kind === "episode" ? target.season : 1);
  const [episode, setEpisode] = useState(target.kind === "episode" ? target.episode : 1);

  const submit = async (dateIso: string) => {
    setSaving(true);
    setError(null);
    try {
      const episodeInfo = target.kind === "episode" ? { season, episode } : undefined;
      await onLog(dateIso, episodeInfo);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log watch");
      setSaving(false);
    }
  };

  const releaseDate = target.kind === "movie" ? target.releaseDate : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-700/60 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">When did you watch this?</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Episode pickers for series */}
        {target.kind === "episode" && (
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Season</label>
              <input
                type="number"
                min={1}
                value={season}
                onChange={(e) => setSeason(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-slate-700/60 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Episode</label>
              <input
                type="number"
                min={1}
                value={episode}
                onChange={(e) => setEpisode(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full rounded-lg border border-slate-700/60 bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
              />
            </div>
          </div>
        )}

        {mode === "quick" ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(new Date().toISOString())}
              className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              Just finished
            </button>
            {releaseDate && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const [y, m, d] = releaseDate.split("-").map(Number);
                  void submit(new Date(Date.UTC(y, m - 1, d, 12)).toISOString());
                }}
                className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                Release date
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit(new Date("2000-01-01T00:00:00.000Z").toISOString())}
              className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              Unknown date
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className="rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              Other date
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="date"
              value={customDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setCustomDate(e.target.value)}
              className="w-full rounded-xl border border-slate-700/60 bg-slate-950 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("quick")}
                className="flex-1 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving || !customDate}
                onClick={() => {
                  const [y, m, d] = customDate.split("-").map(Number);
                  void submit(new Date(Date.UTC(y, m - 1, d, 12)).toISOString());
                }}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Log Watch"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

/* ─── Check-in Modal (series episode picker) ─────────────── */

function CheckInModal({
  seriesName,
  defaultSeason,
  defaultEpisode,
  onCheckIn,
  onClose,
}: {
  seriesName: string;
  defaultSeason: number;
  defaultEpisode: number;
  onCheckIn: (season: number, episode: number) => Promise<void>;
  onClose: () => void;
}) {
  const [season, setSeason] = useState(String(defaultSeason));
  const [episode, setEpisode] = useState(String(defaultEpisode));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = async () => {
    const s = parseInt(season, 10);
    const ep = parseInt(episode, 10);
    if (!s || !ep || s < 1 || ep < 1) { setError("Enter valid season and episode numbers"); return; }
    setSaving(true);
    setError(null);
    try {
      await onCheckIn(s, ep);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check in");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkin-modal-title"
        className="w-full max-w-sm rounded-2xl border border-slate-800/60 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-red-400" />
            <h3 id="checkin-modal-title" className="text-base font-bold">Check In</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-400">Which episode of <span className="font-semibold text-slate-200">{seriesName}</span> are you watching?</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Season</label>
              <input
                type="number" min="1" value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full rounded-xl border border-slate-700/60 bg-slate-900 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Episode</label>
              <input
                type="number" min="1" value={episode}
                onChange={(e) => setEpisode(e.target.value)}
                className="w-full rounded-xl border border-slate-700/60 bg-slate-900 px-3 py-2.5 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
              />
            </div>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose}
              className="flex-1 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button" disabled={saving} onClick={() => void submit()}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
            >
              <Radio className="h-3.5 w-3.5" />
              {saving ? "Checking in…" : "Check In"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── External Ratings ────────────────────────────────────── */

function ExternalRatings({
  imdbRating, rtScore, mcScore,
}: {
  imdbRating: number | null | undefined;
  rtScore: number | null | undefined;
  mcScore: number | null | undefined;
}) {
  if (imdbRating == null && rtScore == null && mcScore == null) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Ratings</h3>
      <div className="flex flex-wrap items-center gap-4">
        {imdbRating != null && (
          <div className="flex items-center gap-1.5">
            <ImdbLogo />
            <span className="text-sm font-semibold text-slate-200">{imdbRating.toFixed(1)}</span>
            <span className="text-xs text-slate-500">/10</span>
          </div>
        )}
        {rtScore != null && (
          <div className="flex items-center gap-1.5">
            <RtLogo score={rtScore} />
            <span className={`text-sm font-semibold ${rtScore >= 60 ? "text-green-400" : "text-rose-400"}`}>{rtScore}%</span>
          </div>
        )}
        {mcScore != null && (
          <div className="flex items-center gap-1.5">
            <McIcon score={mcScore} />
            <span className="text-sm font-semibold text-slate-200">{mcScore}</span>
            <span className="text-xs text-slate-500">/100</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Star Rating Component ───────────────────────────────── */

export function StarRating({
  imdbId, type, onError,
}: {
  imdbId: string; type: MediaType; onError?: (message: string) => void;
}) {
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setUserRating(null); setHoverRating(null); setLoaded(false); setLoadError(null);
    let canceled = false;
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        if (!canceled) setUserRating(res.rating.rating);
      } catch (err) {
        if (!canceled) {
          if (!(err instanceof ApiError && err.status === 404)) {
            setLoadError(err instanceof Error ? err.message : "Failed to load rating");
          }
        }
      } finally {
        if (!canceled) setLoaded(true);
      }
    })();
    return () => { canceled = true; };
  }, [imdbId, type]);

  const handleRate = async (rating: number) => {
    if (saving) return;
    if (userRating === rating) {
      setSaving(true);
      try { await api.deleteRating(type, imdbId); setUserRating(null); setHoverRating(null); }
      catch (err) { onError?.(err instanceof Error ? err.message : "Failed to remove rating"); }
      finally { setSaving(false); }
      return;
    }
    setSaving(true);
    try { const res = await api.setRating(imdbId, type, rating); setUserRating(res.rating.rating); setHoverRating(null); }
    catch (err) { onError?.(err instanceof Error ? err.message : "Failed to save rating"); }
    finally { setSaving(false); }
  };

  const retryLoadRating = useCallback(() => {
    setLoadError(null); setLoaded(false);
    void (async () => {
      try {
        const res = await api.getRating(type, imdbId);
        setUserRating(res.rating.rating);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          setLoadError(err instanceof Error ? err.message : "Failed to load rating");
        }
      } finally { setLoaded(true); }
    })();
  }, [imdbId, type]);

  if (!loaded) return <div className="skeleton h-8 w-40 rounded-lg" />;

  const displayRating = hoverRating ?? userRating ?? 0;
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Star className="h-3.5 w-3.5" /> Your Rating
      </h3>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
          <button
            key={star} type="button" disabled={saving}
            onClick={() => void handleRate(star)}
            onMouseEnter={() => setHoverRating(star)}
            onMouseLeave={() => setHoverRating(null)}
            className="p-0.5 transition-transform hover:scale-125 disabled:opacity-50"
            aria-label={`Rate ${star} out of 10`}
          >
            <Star className={`h-5 w-5 transition-colors ${star <= displayRating ? "fill-amber-400 text-amber-400" : "text-slate-600 hover:text-slate-500"}`} />
          </button>
        ))}
        {userRating !== null && <span className="ml-2 text-sm font-semibold text-amber-400">{userRating}/10</span>}
      </div>
      {loadError && (
        <p className="mt-1 flex items-center gap-2 text-xs text-rose-400">
          {loadError}
          <button type="button" onClick={retryLoadRating} className="underline hover:text-rose-300">Retry</button>
        </p>
      )}
    </div>
  );
}

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

  // Cast
  const [cast, setCast] = useState<Array<{ name: string; character: string; photo: string | null }>>([]);
  const [castLoading, setCastLoading] = useState(true);

  // Seasons (series only)
  const [seasons, setSeasons] = useState<Array<{ seasonNumber: number; name: string; episodeCount: number; airYear: number | null; poster: string | null }>>([]);
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
    setCast([]); setCastLoading(true);
    setSeasons([]); setSeasonsLoading(item.type === "series");
    setIsDropped(false); setDroppedLoading(item.type === "series");
    setActiveCheckin(null); setCheckinLoading(true);

    const loads: Promise<void>[] = [
      api.getCast(item.type, item.imdbId).then((r) => {
        if (!cancelled) { setCast(r.cast); setCastLoading(false); }
      }).catch(() => { if (!cancelled) setCastLoading(false); }),
      api.getCheckin().then((r) => {
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
        api.getSeasons(item.imdbId).then((r) => {
          if (!cancelled) { setSeasons(r.seasons); setSeasonsLoading(false); }
        }).catch(() => { if (!cancelled) setSeasonsLoading(false); }),
        api.getDropped(item.imdbId).then((r) => {
          if (!cancelled) { setIsDropped(r.dropped); setDroppedLoading(false); }
        }).catch(() => { if (!cancelled) setDroppedLoading(false); }),
      );
    }

    void Promise.all(loads);
    return () => { cancelled = true; };
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
        const updated = await api.getWatchHistory(50);
        onHistoryChange(updated.filter((e) => (e.seriesImdbId ?? e.imdbId) === item.imdbId || e.imdbId === item.imdbId));
      } catch { /* best-effort */ }
    } else {
      onShowToast("Checked out", "info");
    }
  };

  const handleLog = async (dateIso: string, episodeInfo?: { season: number; episode: number }) => {
    if (!watchTarget) return;
    if (watchTarget.kind === "movie") {
      await api.logWatch({ type: "movie", imdbId: watchTarget.imdbId, watchedAt: dateIso });
    } else {
      await api.logWatch({
        type: "episode",
        imdbId: watchTarget.seriesImdbId,
        seriesImdbId: watchTarget.seriesImdbId,
        season: episodeInfo?.season ?? watchTarget.season,
        episode: episodeInfo?.episode ?? watchTarget.episode,
        watchedAt: dateIso,
      });
    }
    onShowToast("Watch logged!", "success");
    // Refresh history via parent
    try {
      const updated = await api.getWatchHistory(50);
      onHistoryChange(updated.filter((e) => (e.seriesImdbId ?? e.imdbId) === item.imdbId || e.imdbId === item.imdbId));
    } catch { /* best-effort */ }
  };

  const openWatchModal = () => {
    if (item.type === "movie") {
      setWatchTarget({ kind: "movie", imdbId: item.imdbId, releaseDate: item.releaseDate });
    } else {
      // Default to next episode after last watched, or S01E01
      const lastEvent = history.find((e) => e.season != null && e.episode != null);
      const nextSeason = lastEvent?.season ?? 1;
      const nextEpisode = lastEvent ? (lastEvent.episode ?? 0) + 1 : 1;
      setWatchTarget({ kind: "episode", seriesImdbId: item.imdbId, season: nextSeason, episode: nextEpisode });
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-slate-800/60 bg-slate-950 shadow-2xl sm:w-[28rem]">
        {/* Close */}
        <button
          type="button" onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/80 text-slate-400 backdrop-blur hover:bg-slate-800 hover:text-white transition-colors"
          aria-label="Close detail panel"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Poster */}
        <div className="relative w-full" style={{ aspectRatio: "2 / 3", maxHeight: "50vh" }}>
          {item.poster ? (
            <img src={item.poster} alt={item.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
              <Film className="h-20 w-20 text-slate-700" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent" />
        </div>

        {/* Content */}
        <div className="-mt-16 relative z-10 flex-1 space-y-6 px-6 pb-8">

          {/* Title + badges */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide ${item.type === "movie" ? "bg-red-500/90 text-white" : "bg-violet-600/90 text-white"}`}>
                {item.type === "movie" ? <Film className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {item.type === "movie" ? "Movie" : "Series"}
              </span>
              {item.year && <span className="text-sm text-slate-400">{item.year}</span>}
              {item.certification && (
                <span className="rounded-md border border-slate-600/60 px-2 py-0.5 text-xs font-semibold text-slate-300">
                  {item.certification}
                </span>
              )}
              {item.status && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${statusColor(item.status)}`}>
                  {item.status}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">{item.name}</h2>

            {/* Meta row: rating, runtime, network, genres */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {item.rating != null && item.rating > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/20">
                  <Star className="h-3 w-3 fill-amber-400" />{item.rating.toFixed(1)}
                </span>
              )}
              {item.runtime != null && item.runtime > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 px-2.5 py-1 text-xs text-slate-400">
                  <Clock className="h-3 w-3" />{formatRuntime(item.runtime)}
                </span>
              )}
              {item.network && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 px-2.5 py-1 text-xs text-slate-400">
                  <TvMinimalPlay className="h-3 w-3" />{item.network}
                </span>
              )}
              {item.genres.slice(0, 3).map((g) => (
                <span key={g} className="rounded-full bg-slate-800/80 px-2.5 py-1 text-xs text-slate-400">{g}</span>
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

          {/* Check-in / Now Watching */}
          {!checkinLoading && (
            activeCheckin ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                  <span className="text-sm font-semibold text-red-400">Now Watching</span>
                  {activeCheckin.season != null && activeCheckin.episode != null && (
                    <span className="text-xs text-slate-400">S{String(activeCheckin.season).padStart(2,"0")}:E{String(activeCheckin.episode).padStart(2,"0")}</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCheckout(false)}
                    className="flex-1 rounded-xl border border-slate-700/60 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Check Out
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCheckout(true)}
                    className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                  >
                    Finished &amp; Log
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (item.type === "series") {
                    setShowCheckinModal(true);
                  } else {
                    void handleCheckin();
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-red-500/40 hover:bg-red-500/5 hover:text-red-400 transition-colors"
              >
                <Radio className="h-4 w-4" /> Check In
              </button>
            )
          )}

          {/* Description */}
          {item.description && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Overview</h3>
              <p className="text-sm leading-relaxed text-slate-300">{item.description}</p>
            </div>
          )}

          {/* Cast */}
          {castLoading ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Cast</h3>
              <div className="flex gap-3 overflow-hidden">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex-none w-16 space-y-1">
                    <div className="skeleton h-16 w-16 rounded-full" />
                    <div className="skeleton h-2.5 w-14 rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : cast.length > 0 && (
            <div>
              <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <User className="h-3.5 w-3.5" /> Cast
              </h3>
              <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                {cast.map((member) => (
                  <div key={member.name} className="flex-none w-16 text-center">
                    {member.photo ? (
                      <img
                        src={member.photo}
                        alt={member.name}
                        className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10 mx-auto"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto ring-1 ring-white/10">
                        <User className="h-6 w-6 text-slate-600" />
                      </div>
                    )}
                    <p className="mt-1.5 text-2xs font-medium text-slate-300 leading-tight truncate">{member.name}</p>
                    <p className="text-2xs text-slate-600 truncate">{member.character}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Season Breakdown (series only) */}
          {item.type === "series" && (
            seasonsLoading ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Seasons</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}
                </div>
              </div>
            ) : seasons.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <Tv className="h-3.5 w-3.5" /> Seasons
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {seasons.map((s) => (
                    <div key={s.seasonNumber} className="flex items-center gap-2.5 rounded-xl bg-slate-900/60 border border-slate-800/40 px-3 py-2.5">
                      <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-slate-300">
                        {s.seasonNumber}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">{s.name}</p>
                        <p className="text-2xs text-slate-500">{s.episodeCount} eps{s.airYear ? ` · ${s.airYear}` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Watch History */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Clock className="h-3.5 w-3.5" /> Watch History
              </h3>
              <button
                type="button"
                onClick={openWatchModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <Calendar className="h-3 w-3" /> Log a Watch
              </button>
            </div>

            {historyLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-11 rounded-lg" />)}</div>
            ) : history.length === 0 ? (
              <p className="rounded-xl bg-slate-900/60 border border-slate-800/40 py-5 text-center text-sm text-slate-500">
                No watch history yet
              </p>
            ) : (
              <div className="space-y-1.5">
                {history.map((event) => (
                  <div key={event.id} className="group flex items-center gap-3 rounded-lg bg-slate-900/60 border border-slate-800/30 px-3 py-2.5">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                    <div className="min-w-0 flex-1">
                      {event.season != null && event.episode != null ? (
                        <span className="text-sm text-slate-200">
                          S{String(event.season).padStart(2, "0")}:E{String(event.episode).padStart(2, "0")}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-200">Watched</span>
                      )}
                    </div>
                    <time className="shrink-0 text-2xs text-slate-500">
                      {new Date(event.watchedAt).getFullYear() === 2000 && new Date(event.watchedAt).getMonth() === 0
                        ? "Unknown date"
                        : new Date(event.watchedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </time>
                    <button
                      type="button"
                      onClick={() => void handleDeleteEvent(event.id)}
                      className="shrink-0 rounded p-1 text-slate-700 opacity-0 group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-400 transition-all"
                      aria-label="Remove watch event"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drop Show (series only) */}
          {item.type === "series" && !droppedLoading && (
            <div className="pt-2 border-t border-slate-800/40">
              <button
                type="button"
                onClick={() => void handleToggleDrop()}
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isDropped
                    ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    : "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
                }`}
              >
                {isDropped ? "✓ Dropped — Click to Undrop" : "Drop Show"}
              </button>
            </div>
          )}
        </div>
      </aside>

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

export function useDetailPanel() {
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedItem(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!selectedItem) return;
    let cancelled = false;
    const active = selectedItem;

    const needsMeta = !active.description && active.genres.length === 0 && active.rating == null;
    const needsOmdb = active.imdbRating === undefined;
    const needsDetail = active.runtime === undefined;

    if (needsMeta || needsOmdb || needsDetail) {
      void (async () => {
        try {
          const meta = await api.getItemMeta(active.type, active.imdbId);
          if (!cancelled) {
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
          }
        } catch { /* best-effort */ }
      })();
    }

    setPanelHistoryLoading(true);
    void (async () => {
      try {
        const history = await api.getWatchHistory(50);
        if (!cancelled) {
          setPanelHistory(history.filter((e) => (e.seriesImdbId ?? e.imdbId) === active.imdbId || e.imdbId === active.imdbId));
        }
      } catch {
        if (!cancelled) setPanelHistory([]);
      } finally {
        if (!cancelled) setPanelHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedItem]);

  return {
    selectedItem, setSelectedItem,
    panelHistory, setPanelHistory, panelHistoryLoading,
  };
}
