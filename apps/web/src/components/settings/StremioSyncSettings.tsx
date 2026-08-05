import { useCallback, useEffect, useId, useState } from "react";
import { AlertCircle, Check, Loader2, RefreshCw, Unplug } from "lucide-react";
import { api, StremioLibraryStatus, StremioSyncSummary } from "../../api";
import { StatusBadge } from "./StatusBadge";

const summaryText = (summary: StremioSyncSummary): string =>
  summary.recorded > 0
    ? `Recorded ${summary.recorded} watch${summary.recorded === 1 ? "" : "es"} from ${summary.scanned} library item${summary.scanned === 1 ? "" : "s"}`
    : `Nothing new — checked ${summary.scanned} library item${summary.scanned === 1 ? "" : "s"}`;

export function StremioSyncSettings() {
  const [status, setStatus] = useState<StremioLibraryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "import" | "sync" | "disconnect" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const emailId = useId();
  const passwordId = useId();

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await api.getStremioLibraryStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch Stremio status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("connect");
    setError(null);
    setResult(null);
    try {
      setStatus(await api.stremioLibraryConnect(email.trim(), password));
      // Never keep the password around once it has been exchanged for a key.
      setPassword("");
      setResult("Connected. New watches in Stremio will sync from now on.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to Stremio");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setError(null);
    setResult(null);
    try {
      await api.stremioLibraryDisconnect();
      setStatus((prev) => (prev ? { ...prev, connected: false, email: null, connectedAt: null } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  const run = async (kind: "import" | "sync") => {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const summary = kind === "import" ? await api.stremioLibraryImport() : await api.stremioLibrarySync();
      setResult(summaryText(summary));
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind === "import" ? "Import" : "Sync"} failed`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
        <Loader2 size={16} className="animate-spin" /> Checking Stremio status...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge ok={!!status?.connected} label={status?.connected ? "Connected" : "Not connected"} />
        {status?.connected && status.email && (
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            {status.email}
          </span>
        )}
      </div>

      <p className="text-xs" style={{ color: "var(--text-dim)" }}>
        Reads watched state straight from your Stremio account, so anything you finish in Stremio — on
        desktop, mobile, Android TV, the web app, or any other client signed in to the same account — is
        marked watched here without going through Trakt. Your password is exchanged for an access key and
        never stored.
      </p>

      {!status?.connected && (
        <form onSubmit={connect} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor={emailId} className="block text-xs font-semibold" style={{ color: "var(--text-dim)" }}>
              Stremio email
            </label>
            <input
              id={emailId}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full max-w-sm rounded-xl px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)" }}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={passwordId} className="block text-xs font-semibold" style={{ color: "var(--text-dim)" }}>
              Stremio password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full max-w-sm rounded-xl px-3 py-2 text-sm"
              style={{ border: "1px solid var(--border-strong)", background: "var(--bg-1)" }}
            />
          </div>
          <button
            type="submit"
            disabled={busy === "connect" || !email.trim() || !password}
            className="btn-primary"
          >
            {busy === "connect" ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Connecting...
              </>
            ) : (
              "Connect Stremio"
            )}
          </button>
        </form>
      )}

      {status?.connected && (
        <>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Connecting only starts tracking from now on. Run the import once to bring in what your Stremio
            account already has marked as watched, dated from Stremio's own watch history.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run("import")}
              disabled={busy !== null}
              className="btn-primary"
            >
              {busy === "import" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Importing...
                </>
              ) : (
                "Import watch history"
              )}
            </button>
            <button
              type="button"
              onClick={() => run("sync")}
              disabled={busy !== null}
              className="btn-secondary"
            >
              {busy === "sync" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Syncing...
                </>
              ) : (
                <>
                  <RefreshCw size={16} /> Sync now
                </>
              )}
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={busy !== null}
              className="btn-secondary hover:bg-rose-600 hover:text-white"
            >
              <Unplug size={16} /> Disconnect
            </button>
          </div>
        </>
      )}

      {result && (
        <p className="flex items-center gap-2 text-sm text-emerald-600">
          <Check size={16} /> {result}
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
