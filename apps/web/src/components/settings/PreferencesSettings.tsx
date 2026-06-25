import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Loader2, Check, AlertCircle, Shield } from "lucide-react";

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

export function PreferencesSettings() {
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
    return <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}><Loader2 size={16} className="animate-spin" /> Loading preferences...</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Configure metadata language, streaming region, and spoiler protection.
        Changes affect TMDB metadata fetching and Stremio catalog content.
      </p>

      {/* Language */}
      <div>
        <label htmlFor="pref-language" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Metadata Language</label>
        <select
          id="pref-language"
          value={language}
          onChange={(e) => { setLanguage(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-0)] px-4 py-3 text-sm text-[var(--text)] focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        >
          {!COMMON_LANGUAGES.some((l) => l.code === language) && (
            <option value={language}>{language}</option>
          )}
          {COMMON_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
          ))}
        </select>
        <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
          Titles, descriptions, and metadata will be fetched in this language from TMDB.
        </p>
      </div>

      {/* Region */}
      <div>
        <label htmlFor="pref-region" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Streaming Region</label>
        <select
          id="pref-region"
          value={region}
          onChange={(e) => { setRegion(e.target.value); setSaved(false); }}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-0)] px-4 py-3 text-sm text-[var(--text)] focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
        >
          {!COMMON_REGIONS.includes(region) && (
            <option value={region}>{region}</option>
          )}
          {COMMON_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
          Streaming service catalogs (Netflix, Disney+, etc.) show content available in this region.
        </p>
      </div>

      {/* Spoiler Protection */}
      <label htmlFor="pref-spoiler" className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 cursor-pointer transition-colors hover:bg-[var(--surface-strong)]">
        <input
          id="pref-spoiler"
          type="checkbox"
          checked={spoilerProtection}
          onChange={(e) => { setSpoilerProtection(e.target.checked); setSaved(false); }}
          className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--bg-0)] text-claw-500 focus:ring-claw-500/30"
        />
        <div>
          <span className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Shield size={14} className="text-plum-500" />
            Spoiler Protection
          </span>
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-mute)" }}>
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
