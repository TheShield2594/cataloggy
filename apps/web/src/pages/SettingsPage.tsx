import { FormEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, runtimeConfig } from "../api";
import { ChevronDown, Key, Link, Database, Info, Eye, EyeOff, Loader2, Check, AlertCircle, Unplug, Clapperboard, Image } from "lucide-react";

declare const __APP_VERSION__: string;
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";

function Section({ title, icon, defaultOpen, children }: { title: string; icon: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0);
  const id = useId();
  const buttonId = `${id}-toggle`;
  const panelId = `${id}-panel`;

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
    <div className="rounded-2xl border border-slate-800/60 bg-slate-900/40 overflow-hidden">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 px-5 py-[1.125rem] text-left transition-colors hover:bg-slate-800/30"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800/60 text-slate-400">{icon}</span>
        <span className="flex-1 text-base font-semibold">{title}</span>
        <ChevronDown
          size={18}
          className={`text-slate-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={panelId}
        ref={contentRef}
        role="region"
        aria-labelledby={buttonId}
        style={{ height: height !== undefined ? `${height}px` : "auto" }}
        className="overflow-hidden transition-[height] duration-300 ease-in-out"
      >
        <div className="border-t border-slate-800/40 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20" : "bg-slate-800 text-slate-400 ring-1 ring-slate-700/60"
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
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">
        The API token authenticates requests to your Cataloggy server. It is stored in localStorage.
      </p>
      <div className="relative">
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          className="w-full rounded-xl border border-slate-700/60 bg-slate-950 px-4 py-3 pr-20 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
        />
        <button
          type="button"
          onClick={() => setShowToken((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          aria-label={showToken ? "Hide token" : "Show token"}
        >
          {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="text-xs text-amber-400/80">Only use this on trusted devices.</p>
      <button
        type="submit"
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
          saved
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
            : "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20"
        }`}
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
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Checking Trakt status...</div>;
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
            type="button"
            onClick={connect}
            disabled={!status?.configured}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-red-600 disabled:opacity-60 shadow-lg shadow-red-500/20"
            >
              {importing ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : "Run Import"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-rose-600 border border-slate-700/60"
            >
              <Unplug size={16} /> Disconnect
            </button>
            <button
              type="button"
              onClick={fetchStatus}
              className="rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-slate-700 border border-slate-700/60"
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

function RpdbSection() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.getRpdbStatus();
        setConfigured(status.configured);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load RPDB status");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const trimmed = apiKey.trim();
      const result = await api.setRpdbKey(trimmed);
      setConfigured(result.configured);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save RPDB key");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.removeRpdbKey();
      setConfigured(false);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove RPDB key");
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Checking RPDB status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">
        RPDB (Rating Poster Database) overlays rating badges directly onto poster images.
        When enabled, all posters in Stremio will show IMDb/TMDB ratings on the poster artwork.
        Get an API key at{" "}
        <a href="https://ratingposterdb.com/api-key/" target="_blank" rel="noopener noreferrer" className="text-red-400 underline hover:text-red-300">
          ratingposterdb.com
        </a>.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge ok={configured} label={configured ? "Active" : "Not configured"} />
      </div>

      {configured ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={disconnect}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-rose-600 border border-slate-700/60"
          >
            <Unplug size={16} /> Remove Key
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your RPDB API key"
              className="w-full rounded-xl border border-slate-700/60 bg-slate-950 px-4 py-3 pr-20 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
            />
            <button
              type="button"
              onClick={() => setShowKey((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              aria-label={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            type="submit"
            disabled={saving || !apiKey.trim()}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
              saved
                ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
                : "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20 disabled:opacity-50"
            }`}
          >
            {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save RPDB Key"}
          </button>
        </form>
      )}

      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

const CATALOG_LABELS: Record<string, string> = {
  my_watchlist_movies: "Watchlist Movies",
  my_watchlist_series: "Watchlist Series",
  my_recent_movies: "Recently Watched Movies",
  my_continue_series: "Continue Watching Series",
};

function AddonConfigSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getAddonConfig();
        setEnabled(res.config.enabledCatalogs);
        setAvailable(res.availableCatalogs);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load config");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (catalog: string) => {
    setEnabled((prev) =>
      prev.includes(catalog) ? prev.filter((c) => c !== catalog) : [...prev, catalog]
    );
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAddonConfig(enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading configuration...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">
        Choose which catalogs appear in Stremio. Changes take effect after the manifest cache refreshes (~60s).
      </p>
      <div className="space-y-2">
        {available.map((catalog) => (
          <label
            key={catalog}
            className="flex items-center gap-3 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-900/60"
          >
            <input
              type="checkbox"
              checked={enabled.includes(catalog)}
              onChange={() => toggle(catalog)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
            />
            <span className="text-sm font-medium text-slate-200">{CATALOG_LABELS[catalog] ?? catalog}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
          saved
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
            : "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/20"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Configuration"}
      </button>
      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
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
    <div className="space-y-4">
      <p className="text-sm text-slate-400 leading-relaxed">Re-fetch metadata (posters, descriptions, etc.) for all tracked items from TMDB.</p>
      <button
        type="button"
        onClick={refreshAll}
        disabled={syncing}
        className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-red-600 disabled:opacity-60 shadow-lg shadow-red-500/20"
      >
        {syncing ? <><Loader2 size={16} className="animate-spin" /> Syncing...</> : "Sync all metadata"}
      </button>
      {result && <p className="flex items-center gap-2 text-sm text-emerald-400"><Check size={16} /> {result}</p>}
      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Section title="API Token" icon={<Key size={20} />} defaultOpen>
        <ApiTokenSection />
      </Section>

      <Section title="Trakt Integration" icon={<Link size={20} />}>
        <TraktSection />
      </Section>

      <Section title="Stremio Addon" icon={<Clapperboard size={20} />}>
        <AddonConfigSection />
      </Section>

      <Section title="RPDB Posters" icon={<Image size={20} />}>
        <RpdbSection />
      </Section>

      <Section title="Data" icon={<Database size={20} />}>
        <DataSection />
      </Section>

      <Section title="About" icon={<Info size={20} />}>
        <div className="space-y-2 text-sm text-slate-400">
          <p className="text-base font-semibold text-slate-200">Cataloggy <span className="font-mono text-red-400">v{APP_VERSION}</span></p>
          <p className="text-sm">A personal media catalog and watchlist manager.</p>
        </div>
      </Section>
    </div>
  );
}
