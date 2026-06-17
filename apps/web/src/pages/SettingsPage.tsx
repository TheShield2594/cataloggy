import { FormEvent, ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { api, runtimeConfig } from "../api";
import { ChevronDown, Key, Link, Database, Info, Eye, EyeOff, Loader2, Check, AlertCircle, Unplug, Clapperboard, Image, Globe, Shield, Copy, ExternalLink, Star, Sparkles, Clock, Bell, Users, Download, Upload } from "lucide-react";
import { timeAgo } from "../utils/timeAgo";
import { isPushSupported, getExistingPushSubscription, subscribeToPush, unsubscribeFromPush } from "../utils/push";

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
    <div className="rounded-2xl border border-ink-100 bg-cream-50 shadow-sm overflow-hidden">
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 px-5 py-[1.125rem] text-left transition-colors hover:bg-ink-100/40"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-500">{icon}</span>
        <span className="flex-1 text-base font-semibold text-ink-900">{title}</span>
        <ChevronDown
          size={18}
          className={`text-ink-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
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
        <div className="border-t border-ink-100 px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/20" : "bg-ink-100 text-ink-500 ring-1 ring-ink-200"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-ink-400"}`} />
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
      <p className="text-sm text-ink-600 leading-relaxed">
        The API token authenticates requests to your Cataloggy server. It is stored in localStorage.
      </p>
      <div className="relative">
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste your API token"
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-20 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        />
        <button
          type="button"
          onClick={() => setShowToken((p) => !p)}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
          aria-label={showToken ? "Hide token" : "Show token"}
        >
          {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="text-xs text-amber-600">Only use this on trusted devices.</p>
      <button
        type="submit"
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${
          saved
            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20"
            : "bg-claw-500 text-white hover:bg-claw-600 shadow-lg shadow-claw-500/20"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : "Save token"}
      </button>
    </form>
  );
}

export function TraktSection() {
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
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Checking Trakt status...</div>;
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
        <div className="rounded-xl border border-ink-100 bg-cream-100 px-4 py-3 space-y-1">
          <p className="text-xs text-ink-600">
            Your Trakt app's <strong className="text-ink-700">Redirect URI</strong> must be set to:
          </p>
          <code className="block text-sm text-claw-600 break-all select-all">{status.redirectUri}</code>
          <p className="text-xs text-ink-600">
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
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-rose-600 hover:text-white border border-ink-200"
            >
              <Unplug size={16} /> Disconnect
            </button>
            <button
              type="button"
              onClick={fetchStatus}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100 border border-ink-200"
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

function OmdbSection() {
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
        const status = await api.getOmdbStatus();
        setConfigured(status.configured);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load OMDB status");
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
      const result = await api.setOmdbKey(apiKey.trim());
      setConfigured(result.configured);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save OMDB key");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    try {
      await api.removeOmdbKey();
      setConfigured(false);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove OMDB key");
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Checking OMDB status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        OMDB provides ratings from <strong className="text-ink-700">IMDb</strong>, <strong className="text-ink-700">Rotten Tomatoes</strong>, and <strong className="text-ink-700">Metacritic</strong> for every movie and show in your detail panels.
        Get a free API key at{" "}
        <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener noreferrer" className="text-claw-600 underline hover:text-claw-500">
          omdbapi.com
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
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-rose-600 hover:text-white border border-ink-200"
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
              placeholder="Paste your OMDB API key"
              className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-20 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
            />
            <button
              type="button"
              onClick={() => setShowKey((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
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
                ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
                : "bg-claw-500 text-white hover:bg-claw-600 disabled:opacity-50"
            }`}
          >
            {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save OMDB Key"}
          </button>
        </form>
      )}

      {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
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
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Checking RPDB status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        RPDB (Rating Poster Database) overlays rating badges directly onto poster images.
        When enabled, all posters across the web UI and Stremio will show rating badges on the artwork.
        Get an API key at{" "}
        <a href="https://ratingposterdb.com/api-key/" target="_blank" rel="noopener noreferrer" className="text-claw-600 underline hover:text-claw-500">
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
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-rose-600 hover:text-white border border-ink-200"
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
              className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 pr-20 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
            />
            <button
              type="button"
              onClick={() => setShowKey((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
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
                ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
                : "bg-claw-500 text-white hover:bg-claw-600 disabled:opacity-50"
            }`}
          >
            {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save RPDB Key"}
          </button>
        </form>
      )}

      {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
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
  "cataloggy-ai-movie": "AI Picks — Movies",
  "cataloggy-ai-series": "AI Picks — Series",
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
    <div className="rounded-xl border border-ink-200 bg-cream-100 p-4 space-y-3">
      <p className="text-sm font-medium text-ink-700">Manifest URL</p>
      <p className="text-xs text-ink-600 leading-relaxed">
        Copy this URL and paste it into Stremio under <strong className="text-ink-700">Add-ons &rarr; Install from URL</strong>.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-white border border-ink-200 px-3 py-2 text-xs text-claw-600 select-all whitespace-nowrap scrollbar-hide">
          {manifestUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className={`flex-none inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
            copied
              ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
              : copyError
                ? "bg-rose-500/15 text-rose-600 ring-1 ring-rose-500/20"
                : "bg-white text-ink-700 hover:bg-ink-100 border border-ink-200"
          }`}
          aria-label="Copy manifest URL"
        >
          {copied ? <><Check size={13} /> Copied</> : copyError ? <>Failed</> : <><Copy size={13} /> Copy</>}
        </button>
        <a
          href={manifestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none inline-flex items-center gap-1.5 rounded-lg bg-white border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100 transition-colors"
          aria-label="Open manifest URL"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <p className="text-xs text-ink-600">
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
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [res, aiRes] = await Promise.all([api.getAddonConfig(), api.getAiConfig().catch(() => ({ configured: false, config: null, lastGeneratedAt: null }))]);
        setEnabled(res.config.enabledCatalogs);
        setAvailable(res.availableCatalogs);
        setAvailableLists(res.availableLists ?? []);
        setAiConfigured(aiRes.configured);
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
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Loading configuration...</div>;
  }

  return (
    <div className="space-y-4">
      <AddonManifestUrl />
      <p className="text-sm text-ink-600 leading-relaxed">
        Choose which catalogs appear in Stremio. Changes take effect after the manifest cache refreshes (~60s).
      </p>

      {/* Discovery catalogs */}
      <div className="space-y-2">
        {available.map((catalog) => {
          const isAiCatalog = catalog === "cataloggy-ai-movie" || catalog === "cataloggy-ai-series";
          return (
            <label
              key={catalog}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                isAiCatalog
                  ? "border-plum-500/30 bg-plum-500/5 hover:bg-plum-500/10"
                  : "border-ink-100 bg-cream-50 hover:bg-ink-100/40"
              } ${isAiCatalog && !aiConfigured ? "opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={enabled.includes(catalog)}
                onChange={() => toggle(catalog)}
                disabled={isAiCatalog && !aiConfigured}
                className="h-4 w-4 rounded border-ink-300 bg-white text-claw-500 focus:ring-claw-500/30"
              />
              <span className="flex-1 text-sm font-medium text-ink-800">{CATALOG_LABELS[catalog] ?? catalog}</span>
              {isAiCatalog && (
                <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white">
                  <Sparkles className="h-2.5 w-2.5" /> AI
                </span>
              )}
            </label>
          );
        })}
      </div>
      {available.some((c) => c === "cataloggy-ai-movie" || c === "cataloggy-ai-series") && !aiConfigured && (
        <p className="text-xs text-ink-600 italic">Configure AI Recommendations to enable the AI Picks catalogs.</p>
      )}

      {/* User lists */}
      {availableLists.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-500 pt-1">My Lists</p>
          <p className="text-xs text-ink-600">Each list adds separate Movies and Series catalogs to Stremio.</p>
          {availableLists.map((list) => {
            const catalogId = `list:${list.id}`;
            return (
              <label
                key={list.id}
                className="flex items-center gap-3 rounded-xl border border-ink-100 bg-cream-50 px-4 py-3 cursor-pointer transition-colors hover:bg-ink-100/40"
              >
                <input
                  type="checkbox"
                  checked={enabled.includes(catalogId)}
                  onChange={() => toggle(catalogId)}
                  className="h-4 w-4 rounded border-ink-300 bg-white text-claw-500 focus:ring-claw-500/30"
                />
                <span className="text-sm font-medium text-ink-800">{list.name}</span>
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
            ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
            : "bg-claw-500 text-white hover:bg-claw-600"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Configuration"}
      </button>
      {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

const AI_PLACEHOLDER = JSON.stringify(
  {
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    headers: { Authorization: "Bearer nvapi-YOUR_KEY" },
    payload: { model: "nvidia/llama-3.3-nemotron-super-49b-v1", max_tokens: 1024 },
  },
  null,
  2
);

function AiRecommendationsSection() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [rawInput, setRawInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"ok" | "error" | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getAiConfig();
        setConfigured(res.configured);
        setLastGeneratedAt(res.lastGeneratedAt);
        if (res.config) {
          setRawInput(JSON.stringify(res.config, null, 2));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load AI config");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const parseInput = (): Record<string, unknown> | null => {
    try {
      return JSON.parse(rawInput) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const handleChange = (value: string) => {
    setRawInput(value);
    setSaved(false);
    setTestStatus(null);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  const handleTest = async () => {
    const parsed = parseInput();
    if (!parsed) { setJsonError("Invalid JSON"); return; }
    setTesting(true);
    setTestStatus(null);
    setTestMessage(null);
    try {
      const res = await api.testAiConfig(parsed);
      setTestStatus(res.ok ? "ok" : "error");
      setTestMessage(res.message);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const parsed = parseInput();
    if (!parsed) { setJsonError("Invalid JSON"); return; }
    setSaving(true);
    setError(null);
    try {
      await api.saveAiConfig(parsed);
      setConfigured(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save config");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await api.deleteAiConfig();
      setConfigured(false);
      setRawInput("");
      setLastGeneratedAt(null);
      setTestStatus(null);
      setTestMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove config");
    } finally {
      setRemoving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        Connect an OpenAI-compatible LLM to generate personalised recommendations based on your watch history.
        Paste a JSON config with <code className="text-ink-700">url</code>, <code className="text-ink-700">headers</code>, and <code className="text-ink-700">payload</code> fields.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge ok={configured} label={configured ? "Configured" : "Not configured"} />
        {lastGeneratedAt && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-600">
            <Clock size={12} /> Last generated {timeAgo(lastGeneratedAt)}
          </span>
        )}
      </div>

      <textarea
        value={rawInput}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={AI_PLACEHOLDER}
        rows={8}
        className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 font-mono text-xs text-ink-800 placeholder:text-ink-400 focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
        spellCheck={false}
      />
      {jsonError && <p className="text-xs text-rose-600">{jsonError}</p>}

      {testStatus && (
        <p className={`flex items-center gap-2 text-sm ${testStatus === "ok" ? "text-emerald-600" : "text-rose-600"}`}>
          {testStatus === "ok" ? <Check size={14} /> : <AlertCircle size={14} />}
          {testMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !rawInput.trim() || !!jsonError}
          className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-700 transition-all hover:bg-ink-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? <><Loader2 size={14} className="animate-spin" /> Testing…</> : "Test Connection"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !rawInput.trim() || !!jsonError}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
            saved
              ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
              : "bg-plum-500 text-white hover:bg-plum-600 disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          {saved ? <><Check size={14} /> Saved</> : saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : "Save Config"}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {removing ? <><Loader2 size={14} className="animate-spin" /> Removing…</> : "Remove"}
          </button>
        )}
      </div>
      {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

function DataSection() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExport = async () => {
    setExporting(true);
    setImportError(null);
    try {
      const payload = await api.exportData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cataloggy-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleImportJsonFile = async (file: File) => {
    setImportingJson(true);
    setImportResult(null);
    setImportError(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await api.importData(payload);
      const s = res.summary;
      setImportResult(
        `Imported ${s.watchEvents} watch events, ${s.listItems} list items, ${s.seriesProgress} series progress entries, ${s.ratings} ratings`
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingJson(false);
    }
  };

  const handleImportCsvFile = async (file: File) => {
    setImportingCsv(true);
    setImportResult(null);
    setImportError(null);
    try {
      const csv = await file.text();
      const res = await api.importCsv(csv);
      setImportResult(`Imported ${res.summary.imported} watch events (${res.summary.skipped} rows skipped)`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm text-ink-600 leading-relaxed">Re-fetch metadata (posters, descriptions, etc.) for all tracked items from TMDB.</p>
        <button
          type="button"
          onClick={refreshAll}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-claw-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-claw-600 disabled:opacity-60"
        >
          {syncing ? <><Loader2 size={16} className="animate-spin" /> Syncing...</> : "Sync all metadata"}
        </button>
        {result && <p className="flex items-center gap-2 text-sm text-emerald-600"><Check size={16} /> {result}</p>}
        {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
      </div>

      <div className="space-y-4 border-t border-ink-100 pt-5">
        <div>
          <p className="text-sm font-semibold text-ink-700">Export your data</p>
          <p className="text-sm text-ink-600 leading-relaxed">Download a JSON file with your lists, watch history, series progress, and ratings.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-cream-50 px-5 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-60"
        >
          {exporting ? <><Loader2 size={16} className="animate-spin" /> Exporting...</> : <><Download size={16} /> Download export</>}
        </button>
      </div>

      <div className="space-y-4 border-t border-ink-100 pt-5">
        <div>
          <p className="text-sm font-semibold text-ink-700">Import data</p>
          <p className="text-sm text-ink-600 leading-relaxed">
            Restore from a Cataloggy JSON export, or import watch history from a CSV file with columns <code>imdbId,type,season,episode,watchedAt</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={jsonFileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportJsonFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => jsonFileInputRef.current?.click()}
            disabled={importingJson}
            className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-cream-50 px-5 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-60"
          >
            {importingJson ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : <><Upload size={16} /> Import JSON export</>}
          </button>

          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportCsvFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => csvFileInputRef.current?.click()}
            disabled={importingCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-cream-50 px-5 py-2.5 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-60"
          >
            {importingCsv ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : <><Upload size={16} /> Import CSV history</>}
          </button>
        </div>
        {importResult && <p className="flex items-center gap-2 text-sm text-emerald-600"><Check size={16} /> {importResult}</p>}
        {importError && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {importError}</p>}
      </div>
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
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Loading preferences...</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600 leading-relaxed">
        Configure metadata language, streaming region, and spoiler protection.
        Changes affect TMDB metadata fetching and Stremio catalog content.
      </p>

      {/* Language */}
      <div>
        <label htmlFor="pref-language" className="mb-1.5 block text-sm font-medium text-ink-700">Metadata Language</label>
        <select
          id="pref-language"
          value={language}
          onChange={(e) => { setLanguage(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        >
          {!COMMON_LANGUAGES.some((l) => l.code === language) && (
            <option value={language}>{language}</option>
          )}
          {COMMON_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-500">
          Titles, descriptions, and metadata will be fetched in this language from TMDB.
        </p>
      </div>

      {/* Region */}
      <div>
        <label htmlFor="pref-region" className="mb-1.5 block text-sm font-medium text-ink-700">Streaming Region</label>
        <select
          id="pref-region"
          value={region}
          onChange={(e) => { setRegion(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        >
          {!COMMON_REGIONS.includes(region) && (
            <option value={region}>{region}</option>
          )}
          {COMMON_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-500">
          Streaming service catalogs (Netflix, Disney+, etc.) show content available in this region.
        </p>
      </div>

      {/* Spoiler Protection */}
      <label htmlFor="pref-spoiler" className="flex items-start gap-3 rounded-xl border border-ink-100 bg-cream-50 px-4 py-3.5 cursor-pointer transition-colors hover:bg-ink-100/40">
        <input
          id="pref-spoiler"
          type="checkbox"
          checked={spoilerProtection}
          onChange={(e) => { setSpoilerProtection(e.target.checked); setSaved(false); }}
          className="mt-0.5 h-4 w-4 rounded border-ink-300 bg-white text-claw-500 focus:ring-claw-500/30"
        />
        <div>
          <span className="text-sm font-medium text-ink-800 flex items-center gap-2">
            <Shield size={14} className="text-plum-500" />
            Spoiler Protection
          </span>
          <p className="mt-0.5 text-xs text-ink-500">
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
            : "bg-claw-500 text-white hover:bg-claw-600 shadow-lg shadow-claw-500/20"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Preferences"}
      </button>
      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

function NotificationsSection() {
  const supported = isPushSupported();
  const [loading, setLoading] = useState(supported);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const existing = await getExistingPushSubscription();
        setSubscribed(!!existing);
        if (existing) {
          // The server may have dropped this subscription (e.g. a failed
          // send cleaned it up), so re-register it to keep both sides in
          // sync. Best-effort: a failure here doesn't affect the toggle.
          const json = existing.toJSON();
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            await api
              .pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
              .catch(() => {});
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await subscribeToPush();
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable notifications");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <p className="text-sm text-ink-600">Push notifications aren't supported in this browser.</p>;
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Checking notification status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        Get a push notification when the next episode of a series you're tracking airs.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge ok={subscribed} label={subscribed ? "Enabled" : "Disabled"} />
      </div>

      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
          subscribed
            ? "bg-ink-100 border border-ink-200 text-ink-700 hover:bg-rose-600 hover:text-white"
            : "bg-claw-500 text-white hover:bg-claw-600 shadow-lg shadow-claw-500/20"
        }`}
      >
        {busy ? (
          <><Loader2 size={16} className="animate-spin" /> {subscribed ? "Disabling..." : "Enabling..."}</>
        ) : subscribed ? (
          <><Unplug size={16} /> Disable Notifications</>
        ) : (
          <><Bell size={16} /> Enable Notifications</>
        )}
      </button>

      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}

function ProfileSection() {
  const switchProfile = () => {
    runtimeConfig.clearProfileId();
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        Switch to a different profile, or create a new one. Each profile has its own watch history,
        lists, and stats.
      </p>
      <button
        type="button"
        onClick={switchProfile}
        className="inline-flex items-center gap-2 rounded-xl bg-ink-100 border border-ink-200 text-ink-700 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-ink-200"
      >
        <Users size={16} /> Switch Profile
      </button>
    </div>
  );
}

type SettingsTab = "preferences" | "integrations";

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("preferences");

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "preferences", label: "Preferences" },
    { id: "integrations", label: "Integrations & Advanced" },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-2xl font-bold">Settings</h2>

      <div className="flex rounded-full border border-ink-200 bg-ink-100/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              tab === t.id
                ? "bg-claw-500 text-white shadow-lg shadow-claw-500/25"
                : "text-ink-600 hover:text-ink-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "preferences" && (
        <div className="space-y-4">
          <Section title="Preferences" icon={<Globe size={20} />} defaultOpen>
            <PreferencesSection />
          </Section>

          <Section title="Profile" icon={<Users size={20} />}>
            <ProfileSection />
          </Section>

          <Section title="Notifications" icon={<Bell size={20} />}>
            <NotificationsSection />
          </Section>

          <Section title="About" icon={<Info size={20} />}>
            <div className="space-y-2 text-sm text-ink-600">
              <p className="text-base font-semibold text-ink-900">Cataloggy <span className="font-mono text-claw-600">v{APP_VERSION}</span></p>
              <p className="text-sm">A personal media catalog and watchlist manager.</p>
            </div>
          </Section>
        </div>
      )}

      {tab === "integrations" && (
        <div className="space-y-4">
          <Section title="API Token" icon={<Key size={20} />} defaultOpen>
            <ApiTokenSection />
          </Section>

          <Section title="Trakt Integration" icon={<Link size={20} />}>
            <TraktSection />
          </Section>

          <Section title="Stremio Addon" icon={<Clapperboard size={20} />}>
            <AddonConfigSection />
          </Section>

          <Section title="OMDB Ratings" icon={<Star size={20} />}>
            <OmdbSection />
          </Section>

          <Section title="RPDB Posters" icon={<Image size={20} />}>
            <RpdbSection />
          </Section>

          <Section title="AI Recommendations" icon={<Sparkles size={20} />}>
            <AiRecommendationsSection />
          </Section>

          <Section title="Data" icon={<Database size={20} />}>
            <DataSection />
          </Section>
        </div>
      )}
    </div>
  );
}
