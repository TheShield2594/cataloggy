import { useEffect, useState } from "react";
import { api } from "../../api";
import { Loader2, Check, AlertCircle, Clock, ChevronDown } from "lucide-react";
import { timeAgo } from "../../utils/timeAgo";
import { StatusBadge } from "./StatusBadge";

type Provider =
  | "openai"
  | "gemini"
  | "groq"
  | "nvidia"
  | "ollama"
  | "openrouter"
  | "custom";

const PROVIDERS: {
  id: Provider;
  label: string;
  url: string;
  model: string;
  helpUrl: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    helpUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "groq",
    label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    helpUrl: "https://console.groq.com/keys",
  },
  {
    id: "nvidia",
    label: "NVIDIA",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    model: "nvidia/llama-3.3-nemotron-super-49b-v1",
    helpUrl: "https://build.nvidia.com",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    url: "http://localhost:11434/v1/chat/completions",
    model: "llama3.2",
    helpUrl: "https://ollama.com/library",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: "openai/gpt-4o-mini",
    helpUrl: "https://openrouter.ai/keys",
  },
  { id: "custom", label: "Custom", url: "", model: "", helpUrl: "" },
];

const PLACEHOLDER_KEY_PATTERNS = [
  /your_key/i,
  /your-api-key/i,
  /xxxx/i,
  /changeme/i,
  /<.*key.*>/i,
];

function isPlaceholderKey(key: string) {
  return PLACEHOLDER_KEY_PATTERNS.some((re) => re.test(key));
}

function detectProvider(url: string): Provider {
  if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434"))
    return "ollama";
  const match = PROVIDERS.find((p) => p.id !== "custom" && url === p.url);
  return match?.id ?? "custom";
}

function buildConfig(
  provider: Provider,
  url: string,
  apiKey: string,
  model: string,
  maxTokens: number,
) {
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  return {
    url: url.trim(),
    headers,
    payload: { model: model.trim(), max_tokens: maxTokens },
  };
}

export function AiSettings() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<Provider>("openai");
  const [url, setUrl] = useState(PROVIDERS[0].url);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PROVIDERS[0].model);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("");
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<{
    url?: string;
    model?: string;
    apiKey?: string;
  }>({});
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
          const cfg = res.config as {
            url?: string;
            headers?: Record<string, string>;
            payload?: { model?: string; max_tokens?: number };
          };
          const detected = detectProvider(cfg.url ?? "");
          setProvider(detected);
          setUrl(cfg.url ?? "");
          const auth = cfg.headers?.Authorization ?? "";
          setApiKey(auth.replace(/^Bearer\s+/i, ""));
          setModel(cfg.payload?.model ?? "");
          setMaxTokens(cfg.payload?.max_tokens ?? 4096);
          setAdvancedJson(JSON.stringify(res.config, null, 2));
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load AI config",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleProviderChange = (next: Provider) => {
    setProvider(next);
    setSaved(false);
    setTestStatus(null);
    if (next !== "custom") {
      const preset = PROVIDERS.find((p) => p.id === next)!;
      setUrl(preset.url);
      setModel(preset.model);
    }
  };

  const validate = (): boolean => {
    const errors: { url?: string; model?: string; apiKey?: string } = {};
    if (!url.trim()) {
      errors.url = "URL is required";
    } else {
      try {
        new URL(url.trim());
      } catch {
        errors.url = "Must be a valid URL";
      }
    }
    if (!model.trim()) errors.model = "Model name is required";
    if (
      provider !== "ollama" &&
      apiKey.trim() &&
      isPlaceholderKey(apiKey.trim())
    ) {
      errors.apiKey = "This looks like a placeholder key, not a real one";
    }
    if (provider !== "ollama" && !apiKey.trim()) {
      errors.apiKey = "API key is required for this provider";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const getConfig = (): Record<string, unknown> | null => {
    if (showAdvanced) {
      try {
        return JSON.parse(advancedJson) as Record<string, unknown>;
      } catch {
        setAdvancedJsonError("Invalid JSON");
        return null;
      }
    }
    if (!validate()) return null;
    return buildConfig(provider, url, apiKey, model, maxTokens);
  };

  const handleTest = async () => {
    const config = getConfig();
    if (!config) return;
    setTesting(true);
    setTestStatus(null);
    setTestMessage(null);
    try {
      const res = await api.testAiConfig(config);
      setTestStatus(res.success ? "ok" : "error");
      setTestMessage(
        res.success
          ? res.response?.trim()
            ? `Connected. Model replied: "${res.response.trim()}"`
            : "Connected."
          : res.error ?? "Test failed",
      );
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const config = getConfig();
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveAiConfig(config);
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
      setUrl(PROVIDERS[0].url);
      setApiKey("");
      setModel(PROVIDERS[0].model);
      setMaxTokens(4096);
      setAdvancedJson("");
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
    return (
      <div
        className="flex items-center gap-2 text-sm"
        style={{ color: "var(--text-dim)" }}
      >
        <Loader2 size={16} className="animate-spin" /> Loading...
      </div>
    );
  }

  const activePreset = PROVIDERS.find((p) => p.id === provider);

  return (
    <div className="space-y-4">
      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-dim)" }}
      >
        Connect an OpenAI-compatible LLM to generate personalised
        recommendations based on your watch history.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge
          ok={configured}
          label={configured ? "Configured" : "Not configured"}
        />
        {lastGeneratedAt && (
          <span
            className="inline-flex items-center gap-1.5 text-xs"
            style={{ color: "var(--text-dim)" }}
          >
            <Clock size={12} /> Last generated {timeAgo(lastGeneratedAt)}
          </span>
        )}
      </div>

      {!showAdvanced && (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="ai-provider"
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-dim)" }}
            >
              Provider
            </label>
            <select
              id="ai-provider"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              className="w-full rounded-xl border bg-white px-4 py-2.5 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {activePreset?.helpUrl && (
              <a
                href={activePreset.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-violet-600 underline"
              >
                Where do I find my {activePreset.label} API key?
              </a>
            )}
          </div>

          <div>
            <label
              htmlFor="ai-url"
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-dim)" }}
            >
              Endpoint URL
            </label>
            <input
              id="ai-url"
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
                setTestStatus(null);
              }}
              className="w-full rounded-xl border bg-white px-4 py-2.5 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
              placeholder="https://api.example.com/v1/chat/completions"
            />
            {fieldErrors.url && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.url}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="ai-key"
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-dim)" }}
            >
              API Key{" "}
              {provider === "ollama" && (
                <span style={{ color: "var(--text-mute)" }}>
                  (usually not required)
                </span>
              )}
            </label>
            <input
              id="ai-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaved(false);
                setTestStatus(null);
              }}
              className="w-full rounded-xl border bg-white px-4 py-2.5 font-mono text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
              placeholder="sk-..."
              autoComplete="off"
            />
            {fieldErrors.apiKey && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.apiKey}</p>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label
                htmlFor="ai-model"
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--text-dim)" }}
              >
                Model
              </label>
              <input
                id="ai-model"
                type="text"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaved(false);
                  setTestStatus(null);
                }}
                className="w-full rounded-xl border bg-white px-4 py-2.5 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              />
              {fieldErrors.model && (
                <p className="mt-1 text-xs text-rose-600">
                  {fieldErrors.model}
                </p>
              )}
            </div>
            <div className="w-32">
              <label
                htmlFor="ai-max-tokens"
                className="mb-1 block text-xs font-medium"
                style={{ color: "var(--text-dim)" }}
              >
                Max tokens
              </label>
              <input
                id="ai-max-tokens"
                type="number"
                min={1}
                value={maxTokens}
                onChange={(e) => {
                  setMaxTokens(Math.max(1, parseInt(e.target.value) || 4096));
                  setSaved(false);
                  setTestStatus(null);
                }}
                className="w-full rounded-xl border bg-white px-4 py-2.5 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                style={{
                  borderColor: "var(--border-strong)",
                  color: "var(--text)",
                }}
              />
              <p
                className="mt-1 text-xs"
                style={{ color: "var(--text-mute)" }}
              >
                Too low truncates recommendations
              </p>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (!showAdvanced) {
            const config = buildConfig(provider, url, apiKey, model, maxTokens);
            setAdvancedJson(JSON.stringify(config, null, 2));
          }
          setShowAdvanced((v) => !v);
          setAdvancedJsonError(null);
        }}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
      >
        <ChevronDown
          size={14}
          className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
        />
        Advanced: edit raw JSON
      </button>

      {showAdvanced && (
        <div>
          <textarea
            value={advancedJson}
            onChange={(e) => {
              setAdvancedJson(e.target.value);
              setSaved(false);
              setTestStatus(null);
              try {
                JSON.parse(e.target.value);
                setAdvancedJsonError(null);
              } catch {
                setAdvancedJsonError("Invalid JSON");
              }
            }}
            rows={8}
            className="w-full rounded-xl border bg-white px-4 py-3 font-mono text-xs placeholder:text-[var(--text-mute)] focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
            style={{
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
            spellCheck={false}
          />
          {advancedJsonError && (
            <p className="mt-1 text-xs text-rose-600">{advancedJsonError}</p>
          )}
        </div>
      )}

      {testStatus && (
        <p
          className={`flex items-center gap-2 text-sm ${testStatus === "ok" ? "text-emerald-600" : "text-rose-600"}`}
        >
          {testStatus === "ok" ? (
            <Check size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          {testMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold transition-all hover:bg-[var(--surface-strong)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--text-dim)",
          }}
        >
          {testing ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Testing…
            </>
          ) : (
            "Test Connection"
          )}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
            saved
              ? "bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20"
              : "bg-plum-500 text-white hover:bg-plum-600 disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          {saved ? (
            <>
              <Check size={14} /> Saved
            </>
          ) : saving ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : (
            "Save Config"
          )}
        </button>
        {configured && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={removing}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition-all hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {removing ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Removing…
              </>
            ) : (
              "Remove"
            )}
          </button>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle size={16} /> {error}
        </p>
      )}
    </div>
  );
}
