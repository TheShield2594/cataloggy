import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { api, CatalogMeta, runtimeConfig } from "../api";
import { MediaList, SkeletonCards } from "../components/MediaList";
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
    return (
      <div className="space-y-8">
        {["Watchlist", "Continue Watching", "Recently Watched"].map((title) => (
          <section key={title}>
            <h2 className="mb-3 text-lg font-semibold font-heading">{title}</h2>
            <SkeletonCards count={4} />
          </section>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-rose-400" />
        <p className="text-lg font-medium text-rose-300">Unable to connect to the API</p>
        <p className="text-sm text-slate-300">{error}</p>
        <p className="text-sm text-slate-400">
          Current API base: <span className="font-mono text-sky-300">{runtimeConfig.getApiBase()}</span>
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
          >
            Reload
          </button>
          <Link
            to="/settings"
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Settings
          </Link>
        </div>
      </div>
    );
  }

  const sections = [
    { title: "Watchlist", items: watchlist },
    { title: "Continue Watching", items: continueWatching },
    { title: "Recently Watched", items: recentlyWatched },
  ];

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <MediaList
          key={section.title}
          title={section.title}
          items={section.items}
          count={section.items.length}
        />
      ))}
    </div>
  );
}
