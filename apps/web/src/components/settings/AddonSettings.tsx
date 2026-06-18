import { useEffect, useState } from "react";
import { api, runtimeConfig } from "../../api";
import { Loader2, Check, AlertCircle, Copy, ExternalLink, Sparkles } from "lucide-react";

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

export function AddonSettings() {
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
