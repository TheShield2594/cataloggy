import { useEffect, useState } from "react";
import { api, type DetailBundle, SearchResult, WatchEvent } from "../../api";

/* ─── Hook: open panel with history + detail loading ───────── */

/** Everything the panel shows about a title, other than the user's watch history. */
export type PanelDetail = {
  cast: DetailBundle["cast"];
  director: string | null;
  providers: DetailBundle["providers"] | null;
  recommendations: DetailBundle["recommendations"];
  seasons: DetailBundle["seasons"];
  dropped: boolean;
};

// Reopening a title you just closed — which is most of what following a
// recommendation and coming back is — should cost nothing. A minute is long
// enough to cover that and short enough that a rating or a dropped-state change
// made elsewhere in the app shows up promptly.
const BUNDLE_CACHE_TTL_MS = 60_000;
const bundleCache = new Map<string, { at: number; bundle: DetailBundle }>();

/** Called after a mutation that changes what the bundle would return. */
export function invalidateDetailBundle(imdbId: string): void {
  for (const key of [...bundleCache.keys()]) {
    if (key.endsWith(`:${imdbId}`)) bundleCache.delete(key);
  }
}

export function useDetailPanel() {
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const [panelHistory, setPanelHistory] = useState<WatchEvent[]>([]);
  const [panelHistoryLoading, setPanelHistoryLoading] = useState(false);
  const [detail, setDetail] = useState<PanelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Keyed on the identity of the title rather than on the `selectedItem` object.
  // Applying the fetched metadata replaces that object, so depending on it meant
  // every open re-ran this effect and refetched the watch history a second time.
  const imdbId = selectedItem?.imdbId;
  const type = selectedItem?.type;

  useEffect(() => {
    if (!imdbId || !type) {
      setDetail(null);
      setPanelHistory([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    // The API returns the IMDb ID as the name when TMDB has no title for it, and
    // callers building a SearchResult from a list row use the same fallback — so
    // a name equal to the ID is a placeholder, never a real title to keep.
    const applyBundle = (bundle: DetailBundle) => {
      const meta = bundle.meta;
      setSelectedItem((prev) => {
        if (!prev || prev.imdbId !== imdbId) return prev;
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
      setDetail({
        cast: bundle.cast,
        director: bundle.director,
        providers: bundle.providers,
        recommendations: bundle.recommendations,
        seasons: bundle.seasons,
        dropped: bundle.dropped,
      });
    };

    const cacheKey = `${type}:${imdbId}`;
    const cached = bundleCache.get(cacheKey);
    if (cached && Date.now() - cached.at < BUNDLE_CACHE_TTL_MS) {
      // Synchronously, in the same commit that opened the panel: no spinner, no
      // empty cast row that fills in a moment later.
      applyBundle(cached.bundle);
      setDetailLoading(false);
    } else {
      setDetail(null);
      setDetailLoading(true);
      void (async () => {
        try {
          const bundle = await api.getDetailBundle(type, imdbId, controller.signal);
          bundleCache.set(cacheKey, { at: Date.now(), bundle });
          if (!cancelled) applyBundle(bundle);
        } catch {
          // Every section renders an empty state of its own, so a failed bundle
          // leaves the panel showing the title it already had rather than an error.
        } finally {
          if (!cancelled) setDetailLoading(false);
        }
      })();
    }

    setPanelHistoryLoading(true);
    void (async () => {
      try {
        const history = await api.getWatchHistory(50, 0, { imdbId, signal: controller.signal });
        if (!cancelled) setPanelHistory(history);
      } catch {
        if (!cancelled) setPanelHistory([]);
      } finally {
        if (!cancelled) setPanelHistoryLoading(false);
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [imdbId, type]);

  return {
    selectedItem, setSelectedItem,
    panelHistory, setPanelHistory, panelHistoryLoading,
    detail, detailLoading,
  };
}
