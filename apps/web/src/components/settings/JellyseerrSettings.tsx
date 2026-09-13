import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { AlertCircle, Check, Download, Loader2, Send, Unplug } from "lucide-react";
import { api, type JellyseerrConfig } from "../../api";
import { useTransientFlag } from "../../hooks/useTransientFlag";
import { StatusBadge } from "./StatusBadge";

const inputClass =
  "w-full rounded-xl border px-4 py-2.5 text-sm focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/15";
const inputStyle = { borderColor: "var(--border)", color: "var(--text)", background: "var(--bg-1)" };

// The only integration that writes to something outside Cataloggy, so the copy
// leads with what it will do rather than with what it connects to.
export function JellyseerrSettings() {
  const urlId = useId();
  const keyId = useId();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<JellyseerrConfig | null>(null);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [requestOnAdd, setRequestOnAdd] = useState(true);
  const [cancelOnRemove, setCancelOnRemove] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useTransientFlag();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.getJellyseerrConfig();
        setConfig(status.config);
        if (status.config) {
          setUrl(status.config.url);
          setRequestOnAdd(status.config.requestOnAdd);
          setCancelOnRemove(status.config.cancelOnRemove);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Jellyseerr settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const test = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testJellyseerr();
      setTestResult(
        result.success
          ? {
              ok: true,
              message: result.applicationTitle
                ? `Reached ${result.applicationTitle}${result.version ? ` (v${result.version})` : ""}.`
                : "Reached it.",
            }
          : { ok: false, message: result.error ?? "The test could not be completed." }
      );
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "The test could not be completed." });
    } finally {
      setTesting(false);
    }
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const status = await api.saveJellyseerrConfig({
        url: url.trim(),
        // Blank means "keep the key you have" — the server never sends it back
        // for this field to be pre-filled with.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        requestOnAdd,
        cancelOnRemove,
      });
      setConfig(status.config);
      setApiKey("");
      setSaved(true);
      // The save stores; this is what proves it works. Saving a URL a server
      // isn't currently answering on is allowed — the answer shows up here
      // rather than refusing the save, and a failure that persists shows up
      // under Sync Status.
      await test();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Jellyseerr settings");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setError(null);
    setTestResult(null);
    try {
      const status = await api.removeJellyseerrConfig();
      setConfig(status.config);
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Jellyseerr");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
        <Loader2 size={16} className="animate-spin" /> Checking Jellyseerr status...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Send watchlist additions to <strong style={{ color: "var(--text)" }}>Jellyseerr</strong> or{" "}
        <strong style={{ color: "var(--text)" }}>Overseerr</strong>, so adding something here files a request on the
        server that fetches it. Off unless you configure it, and a failure never blocks the watchlist add — it shows up
        under <strong style={{ color: "var(--text)" }}>Sync Status</strong>.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge
          ok={!!config && config.requestOnAdd}
          label={!config ? "Not configured" : config.requestOnAdd ? "Requesting watchlist adds" : "Connected, not requesting"}
        />
      </div>

      <form onSubmit={save} className="space-y-3">
        <div>
          <label htmlFor={urlId} className="mb-1 block text-xs font-medium" style={{ color: "var(--text-dim)" }}>
            Server URL
          </label>
          <input
            id={urlId}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.25:5055"
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor={keyId} className="mb-1 block text-xs font-medium" style={{ color: "var(--text-dim)" }}>
            API key {config?.hasApiKey && <span style={{ color: "var(--text-mute)" }}>— saved; leave blank to keep it</span>}
          </label>
          <input
            id={keyId}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasApiKey ? "••••••••" : "Settings → General → API Key in Jellyseerr"}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <label className="flex items-start gap-3 text-sm" style={{ color: "var(--text-dim)" }}>
          <input
            type="checkbox"
            checked={requestOnAdd}
            onChange={(e) => setRequestOnAdd(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-claw-500"
          />
          <span>
            Request titles added to the watchlist
            <span className="block text-2xs" style={{ color: "var(--text-mute)" }}>
              Only the watchlist. Other lists stay local.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm" style={{ color: "var(--text-dim)" }}>
          <input
            type="checkbox"
            checked={cancelOnRemove}
            onChange={(e) => setCancelOnRemove(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-claw-500"
          />
          <span>
            Cancel the request when a title leaves the watchlist
            <span className="block text-2xs" style={{ color: "var(--text-mute)" }}>
              Only a request nobody has approved yet — an approved one has already started downloading, and un-listing
              something isn't a decision to delete it.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving || !url.trim()} className={`btn-primary ${saved ? "btn-saved" : ""}`}>
            {saved ? (
              <>
                <Check size={16} /> Saved
              </>
            ) : saving ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Checking connection...
              </>
            ) : (
              <>
                <Download size={16} /> Save
              </>
            )}
          </button>

          {config && (
            <>
              <button type="button" onClick={test} disabled={testing} className="btn-secondary">
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Test connection
              </button>
              <button type="button" onClick={disconnect} className="btn-secondary hover:bg-rose-600 hover:text-white">
                <Unplug size={16} /> Disconnect
              </button>
            </>
          )}
        </div>
      </form>

      {testResult && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm"
          style={{ color: testResult.ok ? "var(--text-dim)" : undefined }}
        >
          {testResult.ok ? <Check size={16} /> : <AlertCircle size={16} className="text-danger" />}
          <span className={testResult.ok ? "" : "text-danger"}>{testResult.message}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <AlertCircle size={16} /> {error}
        </p>
      )}
    </div>
  );
}
