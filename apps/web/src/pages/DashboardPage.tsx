import { useEffect, useState } from "react";
import { api, CatalogMeta } from "../api";
import { MediaList } from "../components/MediaList";

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<CatalogMeta[]>([]);
  const [continueWatching, setContinueWatching] = useState<CatalogMeta[]>([]);
  const [recentlyWatched, setRecentlyWatched] = useState<CatalogMeta[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [watch, cont, recent] = await api.dashboard();
        setWatchlist(watch.metas);
        setContinueWatching(cont.metas);
        setRecentlyWatched(recent.metas);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <p className="text-slate-300">Loading dashboard…</p>;
  }

  if (error) {
    return <p className="text-rose-300">{error}</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MediaList title="Watchlist" items={watchlist} />
      <MediaList title="Continue Watching" items={continueWatching} />
      <MediaList title="Recently Watched" items={recentlyWatched} />
    </div>
  );
}
