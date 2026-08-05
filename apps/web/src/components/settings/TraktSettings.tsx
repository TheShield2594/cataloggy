import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Link, Loader2, Check, AlertCircle, Unplug } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

// The server's counters, in the order they read best as a summary. Anything the
// server adds later still shows, under its raw key, rather than disappearing.
const IMPORT_LABELS: Record<string, string> = {
  historyMovies: "movie plays",
  historyEpisodes: "episode plays",
  movies: "movies watched (no play history)",
  episodes: "episodes watched (no play history)",
  ratings: "ratings",
  watchlistMovies: "watchlist movies",
  watchlistShows: "watchlist shows",
  collectionMovies: "collection movies",
  collectionShows: "collection shows",
  lists: "lists",
  listItems: "list items",
  skipped: "skipped (nothing Cataloggy could match)",
};

const summarizeImport = (imported: Record<string, number>): string => {
  const order = Object.keys(IMPORT_LABELS);
  const parts = Object.entries(imported)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const rank = (key: string) => (order.indexOf(key) === -1 ? order.length : order.indexOf(key));
      return rank(a) - rank(b);
    })
    .map(([key, count]) => `${count.toLocaleString()} ${IMPORT_LABELS[key] ?? key}`);

  return parts.length > 0 ? `Imported ${parts.join(", ")}.` : "Already up to date — nothing new to import.";
};

export function TraktSettings() {
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; redirectUri?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await api.getTraktStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Trakt status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const connect = async () => {
    try {
      const { url } = await api.getTraktOAuthUrl();
      // `window.open` — unlike `<a target="_blank">` — does not imply
      // `noopener`, so without it trakt.tv keeps a `window.opener` handle on
      // this tab and could navigate it.
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get OAuth URL");
    }
  };

  const disconnect = async () => {
    try {
      await api.traktDisconnect();
      setStatus((prev) => prev ? { ...prev, connected: false } : prev);
      setImportResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const runImport = async () => {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const result = await api.traktImport();
      setImportResult(summarizeImport(result.imported));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}><Loader2 size={16} className="animate-spin" /> Checking Trakt status...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge ok={!!status?.connected} label={status?.connected ? "Connected" : "Not connected"} />
        {status && !status.configured && (
          <span className="text-xs text-amber-600">Trakt credentials not configured on the server</span>
        )}
      </div>

      {status?.redirectUri && !status.connected && status.configured && (
        <div className="rounded-xl px-4 py-3 space-y-1" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Your Trakt app's <strong style={{ color: "var(--text-dim)" }}>Redirect URI</strong> must be set to:
          </p>
          <code className="block text-sm text-claw-text break-all select-all">{status.redirectUri}</code>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Set this at trakt.tv under Settings &gt; Your API Apps &gt; Edit. A mismatch causes an OAuth error.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!status?.connected && (
          <button
            type="button"
            onClick={connect}
            disabled={!status?.configured}
            className="btn-primary"
          >
            <Link size={16} /> Connect Trakt
          </button>
        )}
        {status?.connected && (
          <>
            <button
              type="button"
              onClick={runImport}
              disabled={importing}
              className="btn-primary"
            >
              {importing ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : "Run Full Import"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="btn-secondary hover:bg-rose-600 hover:text-white"
            >
              <Unplug size={16} /> Disconnect
            </button>
            <button
              type="button"
              onClick={fetchStatus}
              className="btn-secondary"
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {status?.connected && (
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          A full import pulls everything Cataloggy can hold from Trakt: your entire watch history (every play,
          however far back, with its own date), ratings, watchlist, collection and personal lists. It can take
          several minutes on a large library; after it finishes, scheduled syncs only fetch what is new.
        </p>
      )}

      {importResult && (
        <p className="flex items-start gap-2 text-sm text-emerald-600">
          <Check size={16} className="shrink-0 mt-0.5" /> {importResult}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle size={16} /> {error}
        </p>
      )}
    </div>
  );
}
