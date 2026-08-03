import { useEffect, useState } from "react";
import { api, runtimeConfig } from "../../api";
import { Loader2, Check, AlertCircle, Copy, ExternalLink, Sparkles } from "lucide-react";

const AI_CATALOGS = new Set(["cataloggy-ai-movie", "cataloggy-ai-series"]);

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

function AddonManifestUrl({ profileName, multiProfile }: { profileName: string | null; multiProfile: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  // Stremio has no way to say who is watching, so the profile is baked into the
  // installed URL: everything Stremio requests hangs off the manifest URL's
  // base, and the addon reads the profile back out of that path. Without it,
  // marking something watched from Stremio has no profile to write to once a
  // second profile exists.
  const activeProfileId = runtimeConfig.getProfileId();
  const manifestUrl = activeProfileId
    ? `${runtimeConfig.getAddonBase()}/p/${activeProfileId}/manifest.json`
    : `${runtimeConfig.getAddonBase()}/manifest.json`;

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
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--text-dim)" }}>Manifest URL</p>
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-mute)" }}>
        Copy this URL and paste it into Stremio under <strong style={{ color: "var(--text-dim)" }}>Add-ons &rarr; Install from URL</strong>.
        {profileName && (
          <> It installs the addon for <strong style={{ color: "var(--text-dim)" }}>{profileName}</strong>—catalogs and anything you mark as watched from Stremio belong to that profile.</>
        )}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border px-3 py-2 text-xs select-all whitespace-nowrap scrollbar-hide" style={{ borderColor: "var(--border)", background: "var(--bg-0)", color: "var(--text-dim)" }}>
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
                : "hover:bg-[var(--surface-strong)] border"
          }`}
          style={!copied && !copyError ? { color: "var(--text-dim)", borderColor: "var(--border)", background: "var(--bg-0)" } : undefined}
          aria-label="Copy manifest URL"
        >
          {copied ? <><Check size={13} /> Copied</> : copyError ? <>Failed</> : <><Copy size={13} /> Copy</>}
        </button>
        <a
          href={manifestUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-[var(--surface-strong)] transition-colors"
          style={{ color: "var(--text-dim)", borderColor: "var(--border)", background: "var(--bg-0)" }}
          aria-label="Open manifest URL"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <p className="text-xs" style={{ color: "var(--text-mute)" }}>
        The URL points to your local addon server. Stremio must be able to reach it on your network.
        {multiProfile && " To use a different profile in Stremio, switch profiles here and install the URL shown then — each profile has its own."}
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
  const [profileName, setProfileName] = useState<string | null>(null);
  const [multiProfile, setMultiProfile] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [res, aiRes, profilesRes] = await Promise.all([
          api.getAddonConfig(),
          api.getAiConfig().catch(() => ({ configured: false, config: null, lastGeneratedAt: null })),
          api.getProfiles().catch(() => ({ profiles: [] })),
        ]);
        setEnabled(res.config.enabledCatalogs);
        setAvailable(res.availableCatalogs);
        setAvailableLists(res.availableLists ?? []);
        setAiConfigured(aiRes.configured);
        const activeProfileId = runtimeConfig.getProfileId();
        setProfileName(profilesRes.profiles.find((p) => p.id === activeProfileId)?.name ?? null);
        setMultiProfile(profilesRes.profiles.length > 1);
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
    return <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-mute)" }}><Loader2 size={16} className="animate-spin" /> Loading configuration...</div>;
  }

  return (
    <div className="space-y-4">
      <AddonManifestUrl profileName={profileName} multiProfile={multiProfile} />
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-mute)" }}>
        Choose which catalogs appear in Stremio
        {multiProfile && profileName ? <> for <strong style={{ color: "var(--text-dim)" }}>{profileName}</strong> — each profile picks its own</> : null}.
        Changes take effect after the manifest cache refreshes (~60s).
      </p>

      {/* Discovery catalogs */}
      <div className="space-y-2">
        {available.map((catalog) => {
          const isAiCatalog = AI_CATALOGS.has(catalog);
          return (
            <label
              key={catalog}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                isAiCatalog
                  ? "border-plum-500/30 bg-plum-500/5 hover:bg-plum-500/10"
                  : "hover:bg-[var(--surface-strong)] border-[var(--border)]"
              } ${isAiCatalog && !aiConfigured ? "opacity-50" : ""}`}
              style={isAiCatalog ? undefined : { background: "var(--surface)" }}
            >
              <input
                type="checkbox"
                checked={enabled.includes(catalog)}
                onChange={() => toggle(catalog)}
                disabled={isAiCatalog && !aiConfigured}
                className="h-4 w-4 rounded text-claw-500 focus:ring-claw-500/30 border-[var(--border-strong)]"
                style={{ background: "var(--bg-0)" }}
              />
              <span className="flex-1 text-sm font-medium" style={{ color: "var(--text)" }}>{CATALOG_LABELS[catalog] ?? catalog}</span>
              {isAiCatalog && (
                <span className="inline-flex items-center gap-1 rounded-md bg-plum-500/80 px-1.5 py-0.5 text-2xs font-semibold text-white">
                  <Sparkles className="h-2.5 w-2.5" /> AI
                </span>
              )}
            </label>
          );
        })}
      </div>
      {available.some((c) => AI_CATALOGS.has(c)) && !aiConfigured && (
        <p className="text-xs italic" style={{ color: "var(--text-mute)" }}>Configure AI Recommendations to enable the AI Picks catalogs.</p>
      )}

      {/* User lists */}
      {availableLists.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider pt-1" style={{ color: "var(--text-mute)" }}>My Lists</p>
          <p className="text-xs" style={{ color: "var(--text-mute)" }}>Each list adds separate Movies and Series catalogs to Stremio.</p>
          {availableLists.map((list) => {
            const catalogId = `list:${list.id}`;
            return (
              <label
                key={list.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--surface-strong)] border-[var(--border)]"
                style={{ background: "var(--surface)" }}
              >
                <input
                  type="checkbox"
                  checked={enabled.includes(catalogId)}
                  onChange={() => toggle(catalogId)}
                  className="h-4 w-4 rounded text-claw-500 focus:ring-claw-500/30 border-[var(--border-strong)]"
                  style={{ background: "var(--bg-0)" }}
                />
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{list.name}</span>
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
            : "bg-claw-500 text-claw-on hover:bg-claw-600"
        }`}
      >
        {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : "Save Configuration"}
      </button>
      {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}
