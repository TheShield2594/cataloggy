import { FormEvent, useEffect, useRef, useState } from "react";
import { api, TmdbStatus } from "../../api";
import { Eye, EyeOff, Loader2, Check, AlertCircle, Unplug } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

const STATUS_LABEL: Record<"db" | "env", string> = {
  db: "Active",
  env: "Active (environment)",
};

export function TmdbSettings() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TmdbStatus>({ configured: false, source: null });
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
        setStatus(await api.getTmdbStatus());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load TMDB status");
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
      setStatus(await api.setTmdbKey(apiKey.trim()));
      setApiKey("");
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save TMDB key");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      setStatus(await api.removeTmdbKey());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove TMDB key");
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}><Loader2 size={16} className="animate-spin" /> Checking TMDB status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        TMDB provides the posters, ratings, cast and episode data for every movie and show in your
        catalog — without a key, searching and metadata refreshes stop working. Get a free API key at{" "}
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" className="text-claw-text underline underline-offset-2 hover:decoration-2">
          themoviedb.org
        </a>.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge
          ok={status.configured}
          label={status.source ? STATUS_LABEL[status.source] : "Not configured"}
        />
      </div>

      {status.source === "env" && (
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
          This key comes from the <code style={{ color: "var(--text-dim)" }}>TMDB_API_KEY</code>{" "}
          environment variable. Saving a key below overrides it, no restart needed.
        </p>
      )}

      {/* The form stays available once a key is saved: rotating a key by
          removing the old one first would leave the app without metadata in
          between, which for TMDB means a broken catalog rather than a missing
          extra. */}
      <form onSubmit={save} className="space-y-3">
        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status.configured ? "Paste a new TMDB API key" : "Paste your TMDB API key"}
            aria-label="TMDB API key"
            className="w-full rounded-xl border px-4 py-3 pr-20 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15"
            style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" }}
          />
          <button
            type="button"
            onClick={() => setShowKey((p) => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--text-dim)]"
            style={{ color: "var(--text-mute)" }}
            aria-label={showKey ? "Hide key" : "Show key"}
          >
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || !apiKey.trim()}
            className={`btn-primary ${saved ? "btn-saved" : ""}`}
          >
            {saved ? <><Check size={16} /> Saved</> : saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : status.configured ? "Replace TMDB Key" : "Save TMDB Key"}
          </button>
          {status.source === "db" && (
            <button
              type="button"
              onClick={remove}
              className="btn-secondary hover:bg-rose-600 hover:text-white"
            >
              <Unplug size={16} /> Remove Key
            </button>
          )}
        </div>
      </form>

      {error && <p role="alert" className="flex items-center gap-2 text-sm text-danger"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}
