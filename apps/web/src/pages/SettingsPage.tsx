import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api, runtimeConfig } from "../api";
import { ChevronDown, Key, Link, Database, Info, Eye, EyeOff, Loader2, Check, AlertCircle, Unplug } from "lucide-react";

const APP_VERSION = "0.1.0";

function Section({ title, icon, defaultOpen, children }: { title: string; icon: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current) return;
    if (open) {
      setHeight(contentRef.current.scrollHeight);
      const timer = setTimeout(() => setHeight(undefined), 300);
      return () => clearTimeout(timer);
    } else {
      setHeight(contentRef.current.scrollHeight);
      requestAnimationFrame(() => setHeight(0));
    }
  }, [open]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-800/40"
      >
        <span className="text-slate-400">{icon}</span>
        <span className="flex-1 text-base font-semibold">{title}</span>
        <ChevronDown
          size={18}
          className={`text-slate-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        ref={contentRef}
        style={{ height: height !== undefined ? `${height}px` : "auto" }}
        className="overflow-hidden transition-[height] duration-300 ease-in-out"
      >
        <div className="border-t border-slate-800 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/50 text-slate-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-500"}`} />
      {label}
    </span>
  );
}

function ApiTokenSection() {
  const [token, setToken] = useState(runtimeConfig.getToken());
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = (e: FormEvent) => {
    e.preventDefault();
    runtimeConfig.setToken(token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <p className="text-sm text-slate-400">
        The API token authenticates requests to your Cataloggy server. It is stored in localStorage.
      </p>
      <div className="relative">
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-20 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={() => setShowToken((p) => !p)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
          aria-label={showToken ? "Hide token" : "Show token"}
        >
          {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="text-xs text-amber-400/80">Only use this on trusted devices.</p>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-sky-500"
      >
        {saved ? <><Check size={16} /> Saved</> : "Save token"}
      </button>
    </form>
  );
}

function TraktSection() {
  const [status, setStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
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
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Checking Trakt status…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <StatusBadge ok={!!status?.connected} label={status?.connected ? "Connected" : "Not connected"} />
        {status && !status.configured && (
          <span className="text-xs text-amber-400">Trakt credentials not configured on the server</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {!status?.connected && (
          <button
            onClick={connect}
            disabled={!status?.configured}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Link size={16} /> Connect Trakt
          </button>
        )}
        {status?.connected && (
          <>
            <button
              onClick={runImport}
              disabled={importing}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-sky-500 disabled:opacity-60"
            >
              {importing ? <><Loader2 size={16} className="animate-spin" /> Importing…</> : "Run Import"}
            </button>
            <button
              onClick={disconnect}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-rose-600"
            >
              <Unplug size={16} /> Disconnect
            </button>
            <button
              onClick={fetchStatus}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-600"
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {importResult && (
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <Check size={16} /> {importResult}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-400">
          <AlertCircle size={16} /> {error}
        </p>
      )}
    </div>
  );
}

function DataSection() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.refreshAllMetadata();
      setResult(`Refreshed ${res.refreshed} of ${res.total} items`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Metadata sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">Re-fetch metadata (posters, descriptions, etc.) for all tracked items from TMDB.</p>
      <button
        onClick={refreshAll}
        disabled={syncing}
        className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium transition-colors hover:bg-sky-500 disabled:opacity-60"
      >
        {syncing ? <><Loader2 size={16} className="animate-spin" /> Syncing…</> : "Sync all metadata"}
      </button>
      {result && <p className="flex items-center gap-2 text-sm text-emerald-400"><Check size={16} /> {result}</p>}
      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h2 className="text-xl font-semibold">Settings</h2>

      <Section title="API Token" icon={<Key size={20} />} defaultOpen>
        <ApiTokenSection />
      </Section>

      <Section title="Trakt Integration" icon={<Link size={20} />}>
        <TraktSection />
      </Section>

      <Section title="Data" icon={<Database size={20} />}>
        <DataSection />
      </Section>

      <Section title="About" icon={<Info size={20} />}>
        <div className="space-y-1 text-sm text-slate-400">
          <p>Cataloggy <span className="font-mono text-slate-200">v{APP_VERSION}</span></p>
          <p className="text-xs">A personal media catalog and watchlist manager.</p>
        </div>
      </Section>
    </div>
  );
}
