import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Link, Loader2, Check, AlertCircle, Unplug } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

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
      window.open(url, "_blank");
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
      const entries = Object.entries(result.imported);
      setImportResult(entries.length > 0 ? entries.map(([k, v]) => `${k}: ${v}`).join(", ") : "No new items imported");
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
          <code className="block text-sm text-claw-600 break-all select-all">{status.redirectUri}</code>
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
            className="inline-flex items-center gap-2 rounded-xl bg-plum-500 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-plum-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="inline-flex items-center gap-2 rounded-xl bg-claw-500 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-claw-600 disabled:opacity-60 shadow-lg shadow-claw-500/20"
            >
              {importing ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : "Run Import"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-rose-600 hover:text-white border border-[var(--border-strong)]"
              style={{ color: "var(--text-dim)", background: "var(--bg-1)" }}
            >
              <Unplug size={16} /> Disconnect
            </button>
            <button
              type="button"
              onClick={fetchStatus}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-strong)] border border-[var(--border-strong)]"
              style={{ color: "var(--text-dim)", background: "var(--bg-1)" }}
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {importResult && (
        <p className="flex items-center gap-2 text-sm text-emerald-600">
          <Check size={16} /> {importResult}
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
