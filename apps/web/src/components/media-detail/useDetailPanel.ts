import { useEffect, useState } from "react";
import { api, SearchResult, WatchEvent } from "../../api";

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
    // Callers that build a SearchResult from a list row fall back to the IMDb ID
    // when the metadata row hasn't been synced yet, so the placeholder title is
    // itself a reason to fetch — even when every other field is already present.
    const needsName = active.name === active.imdbId;

    if (needsMeta || needsOmdb || needsDetail || needsName) {
      const cacheKey = `${active.type}:${active.imdbId}`;
      const cached = metaCache.get(cacheKey);
      const applyMeta = (meta: Awaited<ReturnType<typeof api.getItemMeta>>) => {
        setSelectedItem((prev) => {
          if (!prev || prev.imdbId !== active.imdbId) return prev;
          // The API falls back to the IMDb ID when TMDB has no title, so only
          // take a name that is a real title — otherwise keep what we had.
          const hasRealName = !!meta.name && meta.name !== prev.imdbId;
          return {
            ...prev,
            name: hasRealName ? meta.name : prev.name,
            year: meta.year ?? prev.year,
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
            tmdbId: meta.tmdbId !== undefined ? meta.tmdbId : prev.tmdbId,
            background: meta.background !== undefined ? meta.background : prev.background,
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
