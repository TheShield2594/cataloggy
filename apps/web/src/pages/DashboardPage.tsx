import { useEffect, useState } from "react";
import { api, CatalogMeta, runtimeConfig } from "../api";
import { MediaList } from "../components/MediaList";
import { Link } from "react-router-dom";

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<CatalogMeta[]>([]);
  const [continueWatching, setContinueWatching] = useState<CatalogMeta[]>([]);
  const [recentlyWatched, setRecentlyWatched] = useState<CatalogMeta[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const results = await api.dashboard();
        setWatchlist(results[0].metas);
        setContinueWatching(results[1].metas);
        setRecentlyWatched(results[2].metas);
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
    return (
      <div className="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
        <p className="font-medium text-rose-300">Unable to connect to the API</p>
        <p className="text-sm text-slate-300">{error}</p>
        <p className="text-sm text-slate-400">
          Current API base: <span className="font-mono text-sky-300">{runtimeConfig.getApiBase()}</span>
        </p>
        <p className="text-sm text-slate-400">
          Make sure the API server is running, then{" "}
          <button type="button" onClick={() => window.location.reload()} className="text-sky-300 underline">
            reload
          </button>
          . You can change the API URL in{" "}
          <Link to="/settings" className="text-sky-300 underline">
            Settings
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MediaList title="Watchlist" items={watchlist} />
      <MediaList title="Continue Watching" items={continueWatching} />
      <MediaList title="Recently Watched" items={recentlyWatched} />
    </div>
  );
}
