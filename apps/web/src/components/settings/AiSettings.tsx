import { useEffect, useState } from "react";
import { api } from "../../api";
import { Loader2, Check, AlertCircle, Clock } from "lucide-react";
import { timeAgo } from "../../utils/timeAgo";
import { StatusBadge } from "./StatusBadge";

const AI_PLACEHOLDER = JSON.stringify(
  {
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    headers: { Authorization: "Bearer nvapi-YOUR_KEY" },
    payload: { model: "nvidia/llama-3.3-nemotron-super-49b-v1", max_tokens: 1024 },
  },
  null,
  2
);

export function AiSettings() {
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
