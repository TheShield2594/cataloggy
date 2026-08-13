import { useEffect, useState } from "react";
import { api, type DetailBundle, SearchResult, WatchEvent } from "../../api";
import { getCacheScope } from "../../utils/dataCache";
import { createScopedMemoCache } from "../../utils/scopedMemoCache";

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
// Enough to cover a browsing run through a carousel and back without letting a
// long session hold a bundle — cast, recommendations and all — for every title
// it ever opened.
const BUNDLE_CACHE_LIMIT = 60;
// Scoped, because `DetailBundle.dropped` is per-profile state: a plain map of
// title to bundle let profile B open a title within the TTL of profile A's
// fetch and be shown A's "Dropped" badge, with an Undrop button that then
// wrote to B's data. The scope makes A's entries unreachable from B, and
// drops them, the moment the active profile changes.
const bundleCache = createScopedMemoCache<DetailBundle>({
  limit: BUNDLE_CACHE_LIMIT,
  ttlMs: BUNDLE_CACHE_TTL_MS,
});

// The id leads so that invalidating a title is a prefix match over both of its
// possible types — see `invalidateDetailBundle`.
const bundleCacheKey = (type: string, imdbId: string) => `${imdbId}:${type}`;

/** Called after a mutation that changes what the bundle would return. */
export function invalidateDetailBundle(imdbId: string): void {
  // Trailing separator: without it `tt123` would also drop `tt1234`.
  bundleCache.invalidate(`${imdbId}:`);
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

    const cacheKey = bundleCacheKey(type, imdbId);
    const cached = bundleCache.get(cacheKey);
    if (cached) {
      // Synchronously, in the same commit that opened the panel: no spinner, no
      // empty cast row that fills in a moment later.
      applyBundle(cached);
      setDetailLoading(false);
    } else {
      setDetail(null);
      setDetailLoading(true);
      // Captured before the await: a profile switch while the request is in
      // flight means this answer belongs to the profile that is no longer
      // active, and must not be cached under the one that is.
      const scope = getCacheScope();
      void (async () => {
        try {
          const bundle = await api.getDetailBundle(type, imdbId, controller.signal);
          bundleCache.setForScope(scope, cacheKey, bundle);
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
