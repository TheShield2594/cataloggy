import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Eye, EyeOff, Loader2, Check, AlertCircle, Unplug } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

export function OmdbSettings() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

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
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
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
