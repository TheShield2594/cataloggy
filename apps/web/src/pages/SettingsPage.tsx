import { FormEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, runtimeConfig } from "../api";
import { ChevronDown, Key, Link, Database, Info, Eye, EyeOff, Loader2, Check, AlertCircle, Unplug, Clapperboard, Image, Globe, Shield, Copy, ExternalLink } from "lucide-react";

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

      {status?.redirectUri && !status.connected && status.configured && (
        <div className="rounded-xl border border-slate-800/40 bg-slate-950/50 px-4 py-3 space-y-1">
          <p className="text-xs text-slate-400">
            Your Trakt app's <strong className="text-slate-300">Redirect URI</strong> must be set to:
          </p>
          <code className="block text-sm text-red-400 break-all select-all">{status.redirectUri}</code>
          <p className="text-xs text-slate-500">
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
  "cataloggy-trending-movie": "Trending Movies",
  "cataloggy-trending-series": "Trending Series",
  "cataloggy-popular-movie": "Popular Movies",
  "cataloggy-popular-series": "Popular Series",
  "cataloggy-recommended-movie": "Recommended Movies",
  "cataloggy-recommended-series": "Recommended Series",
  "cataloggy-anime-series": "Anime",
  "cataloggy-anime-movie": "Anime Movies",
  "cataloggy-netflix-movie": "Netflix Movies",
  "cataloggy-netflix-series": "Netflix Series",
  "cataloggy-disney-movie": "Disney+ Movies",
  "cataloggy-disney-series": "Disney+ Series",
  "cataloggy-amazon-movie": "Prime Video Movies",
  "cataloggy-amazon-series": "Prime Video Series",
  "cataloggy-apple-movie": "Apple TV+ Movies",
  "cataloggy-apple-series": "Apple TV+ Series",
  "cataloggy-max-movie": "Max Movies",
  "cataloggy-max-series": "Max Series",
};

function AddonManifestUrl() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const manifestUrl = `${runtimeConfig.getApiBase()}/addon/stremio/manifest.json`;

  const copy = () => {
    navigator.clipboard.writeText(manifestUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    });
  };

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950/60 p-4 space-y-3">
      <p className="text-sm font-medium text-slate-300">Manifest URL</p>
      <p className="text-xs text-slate-400 leading-relaxed">
        Copy this URL and paste it into Stremio under <strong className="text-slate-300">Add-ons &rarr; Install from URL</strong>.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs text-red-400 select-all whitespace-nowrap scrollbar-hide">
          {manifestUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className={`flex-none inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            copied
              ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
              : copyError
                ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/20"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700/60"
          }`}
          aria-label="Copy manifest URL"
        >
          {copied ? <><Check size={13} /> Copied</> : copyError ? <>Failed</> : <><Copy size={13} /> Copy</>}
        </button>
        <a
          href={manifestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none inline-flex items-center gap-1.5 rounded-lg bg-slate-800 border border-slate-700/60 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
          aria-label="Open manifest URL"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <p className="text-xs text-slate-500">
        The URL points to your local API server. Stremio must be able to reach it on your network.
      </p>
    </div>
  );
}

function AddonConfigSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [availableLists, setAvailableLists] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getAddonConfig();
        setEnabled(res.config.enabledCatalogs);
        setAvailable(res.availableCatalogs);
        setAvailableLists(res.availableLists ?? []);
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
      <AddonManifestUrl />
      <p className="text-sm text-slate-400 leading-relaxed">
        Choose which catalogs appear in Stremio. Changes take effect after the manifest cache refreshes (~60s).
      </p>

      {/* Discovery catalogs */}
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

      {/* User lists */}
      {availableLists.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 pt-1">My Lists</p>
          <p className="text-xs text-slate-500">Each list adds separate Movies and Series catalogs to Stremio.</p>
          {availableLists.map((list) => {
            const catalogId = `list:${list.id}`;
            return (
              <label
                key={list.id}
                className="flex items-center gap-3 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-900/60"
              >
                <input
                  type="checkbox"
                  checked={enabled.includes(catalogId)}
                  onChange={() => toggle(catalogId)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
                />
                <span className="text-sm font-medium text-slate-200">{list.name}</span>
              </label>
            );
          })}
        </div>
      )}

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

const COMMON_LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ru-RU", label: "Russian" },
  { code: "ar-SA", label: "Arabic" },
  { code: "hi-IN", label: "Hindi" },
  { code: "nl-NL", label: "Dutch" },
  { code: "sv-SE", label: "Swedish" },
  { code: "pl-PL", label: "Polish" },
  { code: "tr-TR", label: "Turkish" },
  { code: "th-TH", label: "Thai" },
];

const COMMON_REGIONS = [
  "US", "GB", "CA", "AU", "DE", "FR", "ES", "IT", "BR", "MX",
  "JP", "KR", "IN", "NL", "SE", "PL", "TR", "AR", "ZA", "SG",
];

function PreferencesSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("en-US");
  const [region, setRegion] = useState("US");
  const [spoilerProtection, setSpoilerProtection] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Cleanup saved timer on unmount
  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const prefs = await api.getPreferences();
        setLanguage(prefs.language);
        setRegion(prefs.region);
        setSpoilerProtection(prefs.spoilerProtection);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load preferences");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updatePreferences({ language, region, spoilerProtection });
      setLanguage(updated.language);
      setRegion(updated.region);
      setSpoilerProtection(updated.spoilerProtection);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" /> Loading preferences...</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400 leading-relaxed">
        Configure metadata language, streaming region, and spoiler protection.
        Changes affect TMDB metadata fetching and Stremio catalog content.
      </p>

      {/* Language */}
      <div>
        <label htmlFor="pref-language" className="mb-1.5 block text-sm font-medium text-slate-300">Metadata Language</label>
        <select
          id="pref-language"
          value={language}
          onChange={(e) => { setLanguage(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-slate-700/60 bg-slate-950 px-4 py-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
        >
          {!COMMON_LANGUAGES.some((l) => l.code === language) && (
            <option value={language}>{language}</option>
          )}
          {COMMON_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Titles, descriptions, and metadata will be fetched in this language from TMDB.
        </p>
      </div>

      {/* Region */}
      <div>
        <label htmlFor="pref-region" className="mb-1.5 block text-sm font-medium text-slate-300">Streaming Region</label>
        <select
          id="pref-region"
          value={region}
          onChange={(e) => { setRegion(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-slate-700/60 bg-slate-950 px-4 py-3 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/15"
        >
          {!COMMON_REGIONS.includes(region) && (
            <option value={region}>{region}</option>
          )}
          {COMMON_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Streaming service catalogs (Netflix, Disney+, etc.) show content available in this region.
        </p>
      </div>

      {/* Spoiler Protection */}
      <label htmlFor="pref-spoiler" className="flex items-start gap-3 rounded-xl border border-slate-800/40 bg-slate-900/30 px-4 py-3.5 cursor-pointer transition-colors hover:bg-slate-900/60">
        <input
          id="pref-spoiler"
          type="checkbox"
          checked={spoilerProtection}
          onChange={(e) => { setSpoilerProtection(e.target.checked); setSaved(false); }}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500/30"
        />
        <div>
          <span className="text-sm font-medium text-slate-200 flex items-center gap-2">
            <Shield size={14} className="text-violet-400" />
            Spoiler Protection
          </span>
          <p className="mt-0.5 text-xs text-slate-500">
            Hides series descriptions in Stremio for shows you haven't finished watching yet.
          </p>
        </div>
      </label>

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
        {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Preferences"}
      </button>
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

      <Section title="Preferences" icon={<Globe size={20} />}>
        <PreferencesSection />
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
