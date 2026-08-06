import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Loader2, Check, AlertCircle, Shield } from "lucide-react";
import { SelectField } from "../SelectField";

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

  /**
   * Saves on change, like every other section in Settings. These three were
   * the only ones behind an explicit button, which made them read as a form to
   * fill in rather than settings to adjust — and left a changed select silently
   * unsaved if you navigated away.
   *
   * Takes the changed field as an argument rather than reading it back from
   * state: a `setLanguage` immediately followed by a save would otherwise post
   * the previous language, since the state update hasn't landed yet.
   */
  const save = async (patch: Partial<{ language: string; region: string; spoilerProtection: boolean }>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updatePreferences({ language, region, spoilerProtection, ...patch });
      setLanguage(updated.language);
      setRegion(updated.region);
      setSpoilerProtection(updated.spoilerProtection);
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
      // Nothing local to roll back to — the inputs already show the attempted
      // value, and the loader below re-reads the server's on the next mount.
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
        <SelectField
          id="pref-language"
          value={language}
          disabled={saving}
          onChange={(e) => { setLanguage(e.target.value); void save({ language: e.target.value }); }}
          className="w-full rounded-xl px-4 py-3 text-sm"
          wrapperClassName="w-full"
          chevronSize={16}
        >
          {!COMMON_LANGUAGES.some((l) => l.code === language) && (
            <option value={language}>{language}</option>
          )}
          {COMMON_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
          ))}
        </SelectField>
        <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
          Titles, descriptions, and metadata will be fetched in this language from TMDB.
        </p>
      </div>

      {/* Region */}
      <div>
        <label htmlFor="pref-region" className="mb-1.5 block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Streaming Region</label>
        <SelectField
          id="pref-region"
          value={region}
          disabled={saving}
          onChange={(e) => { setRegion(e.target.value); void save({ region: e.target.value }); }}
          className="w-full rounded-xl px-4 py-3 text-sm"
          wrapperClassName="w-full"
          chevronSize={16}
        >
          {!COMMON_REGIONS.includes(region) && (
            <option value={region}>{region}</option>
          )}
          {COMMON_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </SelectField>
        <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
          Streaming service catalogs (Netflix, Disney+, etc.) show content available in this region.
        </p>
      </div>

      {/* Spoiler Protection — a switch rather than a checkbox: it governs an
          ongoing behaviour in Stremio, not a value being submitted. */}
      <label htmlFor="pref-spoiler" className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 cursor-pointer transition-colors hover:bg-[var(--surface-strong)]">
        <input
          id="pref-spoiler"
          type="checkbox"
          role="switch"
          checked={spoilerProtection}
          disabled={saving}
          onChange={(e) => { setSpoilerProtection(e.target.checked); void save({ spoilerProtection: e.target.checked }); }}
          className="switch-control mt-0.5"
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

      {/* Status line, not a control. `aria-live` because the confirmation now
          follows a change the user made to another element — with a submit
          button it was announced as that button's own new label. */}
      <p className="flex min-h-5 items-center gap-2 text-xs" aria-live="polite" style={{ color: "var(--text-mute)" }}>
        {error ? (
          <span className="flex items-center gap-2 text-danger"><AlertCircle size={14} /> {error}</span>
        ) : saving ? (
          <><Loader2 size={14} className="animate-spin" /> Saving...</>
        ) : saved ? (
          <span className="flex items-center gap-2" style={{ color: "var(--status-ok)" }}><Check size={14} /> Saved</span>
        ) : (
          "Changes save automatically."
        )}
      </p>
    </div>
  );
}
