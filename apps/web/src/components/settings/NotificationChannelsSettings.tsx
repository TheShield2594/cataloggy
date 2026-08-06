import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { api, NotificationChannel, NotificationChannelKind } from "../../api";
import { SelectField } from "../SelectField";
import { StatusBadge } from "./StatusBadge";

type KindSpec = {
  id: NotificationChannelKind;
  label: string;
  urlLabel: string;
  urlPlaceholder: string;
  tokenLabel: string | null;
  tokenRequired: boolean;
  help: string;
};

const KINDS: KindSpec[] = [
  {
    id: "ntfy",
    label: "ntfy",
    urlLabel: "Topic URL",
    urlPlaceholder: "https://ntfy.sh/my-topic",
    tokenLabel: "Access token (optional)",
    tokenRequired: false,
    help: "The full topic URL, including the topic itself. A token is only needed for a protected topic.",
  },
  {
    id: "gotify",
    label: "Gotify",
    urlLabel: "Server URL",
    urlPlaceholder: "http://192.168.1.25:8080",
    tokenLabel: "Application token",
    tokenRequired: true,
    help: "Your Gotify server's address. Create an application in Gotify and paste its token here.",
  },
  {
    id: "discord",
    label: "Discord",
    urlLabel: "Webhook URL",
    urlPlaceholder: "https://discord.com/api/webhooks/...",
    tokenLabel: null,
    tokenRequired: false,
    help: "Channel settings → Integrations → Webhooks → Copy Webhook URL.",
  },
  {
    id: "webhook",
    label: "Webhook",
    urlLabel: "URL",
    urlPlaceholder: "https://home.example/api/webhook/cataloggy",
    tokenLabel: "Bearer token (optional)",
    tokenRequired: false,
    help: "Receives a JSON POST with the event, title, message and episode details — for Home Assistant, Slack, n8n, or anything else.",
  },
];

const kindSpec = (kind: NotificationChannelKind): KindSpec => KINDS.find((k) => k.id === kind) ?? KINDS[0];

const inputClass =
  "w-full rounded-xl border px-4 py-2.5 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-1 focus:ring-violet-500/30";
const inputStyle = { borderColor: "var(--border-strong)", color: "var(--text)", background: "var(--bg-1)" };
const labelClass = "mb-1 block text-xs font-medium";
const labelStyle = { color: "var(--text-dim)" };

// Web push needs VAPID keys, https and — on iOS — an installed home-screen app,
// which is exactly what a plain http://192.168.x.x deployment can't provide.
// These channels are the way round that: one HTTP POST to something the
// self-hoster already runs.
export function NotificationChannelsSettings() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not render as "no channels yet" — that reads as a
  // settled fact and invites adding a duplicate of one already there.
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kind, setKind] = useState<NotificationChannelKind>("ntfy");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  useEffect(() => {
    void (async () => {
      try {
        const { channels: loaded } = await api.getNotificationChannels();
        setChannels(loaded);
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load notification channels");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const spec = kindSpec(kind);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      const { channel } = await api.createNotificationChannel({
        kind,
        name: name.trim() || undefined,
        url: url.trim(),
        token: token.trim() || undefined,
      });
      setChannels((current) => [...current, channel]);
      setName("");
      setUrl("");
      setToken("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add channel");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (channel: NotificationChannel) => {
    setBusyId(channel.id);
    try {
      const { channel: updated } = await api.updateNotificationChannel(channel.id, { enabled: !channel.enabled });
      setChannels((current) => current.map((c) => (c.id === channel.id ? updated : c)));
    } catch (err) {
      setResults((current) => ({
        ...current,
        [channel.id]: { ok: false, message: err instanceof Error ? err.message : "Failed to update channel" },
      }));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (channel: NotificationChannel) => {
    if (!window.confirm(`Remove the "${channel.name}" notification channel?`)) return;
    setBusyId(channel.id);
    try {
      await api.deleteNotificationChannel(channel.id);
      setChannels((current) => current.filter((c) => c.id !== channel.id));
    } catch (err) {
      setResults((current) => ({
        ...current,
        [channel.id]: { ok: false, message: err instanceof Error ? err.message : "Failed to remove channel" },
      }));
    } finally {
      setBusyId(null);
    }
  };

  // Sending for real is the only check worth anything: a wrong topic, a
  // rejected token or a server the container can't reach are all invisible
  // from the URL alone, and would otherwise surface hours later as silence.
  const test = async (channel: NotificationChannel) => {
    setBusyId(channel.id);
    setResults((current) => ({ ...current, [channel.id]: { ok: true, message: "Sending..." } }));
    try {
      const result = await api.testNotificationChannel(channel.id);
      setResults((current) => ({
        ...current,
        [channel.id]: result.success
          ? { ok: true, message: "Sent — check the device." }
          : { ok: false, message: result.error ?? "Failed to send" },
      }));
    } catch (err) {
      setResults((current) => ({
        ...current,
        [channel.id]: { ok: false, message: err instanceof Error ? err.message : "Failed to send" },
      }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Somewhere else to send episode notifications, for when browser push isn't an option — it needs https
        and, on iOS, the app added to your home screen. These are a single POST to something you already run.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}>
          <Loader2 size={16} className="animate-spin" /> Loading channels...
        </div>
      ) : loadError ? (
        <p className="flex items-center gap-2 text-sm text-rose-600">
          <AlertCircle size={16} /> {loadError}
        </p>
      ) : channels.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-dim)" }}>
          No channels yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {channels.map((channel) => {
            const result = results[channel.id];
            return (
              <li
                key={channel.id}
                className="rounded-xl border p-3"
                style={{ borderColor: "var(--border)", background: "var(--bg-1)" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {channel.name}
                  </span>
                  <span className="text-2xs uppercase tracking-wide" style={{ color: "var(--text-mute)" }}>
                    {kindSpec(channel.kind).label}
                  </span>
                  <StatusBadge ok={channel.enabled} label={channel.enabled ? "Enabled" : "Disabled"} />
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => test(channel)}
                      disabled={busyId === channel.id}
                      className="rounded-lg p-1.5 hover:bg-[var(--surface-strong)] disabled:opacity-50"
                      style={{ color: "var(--text-dim)" }}
                      title="Send a test notification"
                      aria-label={`Send a test notification to ${channel.name}`}
                    >
                      {busyId === channel.id ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(channel)}
                      disabled={busyId === channel.id}
                      className="rounded-lg px-2 py-1 text-xs hover:bg-[var(--surface-strong)] disabled:opacity-50"
                      style={{ color: "var(--text-dim)" }}
                      aria-label={`${channel.enabled ? "Disable" : "Enable"} ${channel.name}`}
                    >
                      {channel.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(channel)}
                      disabled={busyId === channel.id}
                      className="rounded-lg p-1.5 text-rose-600 hover:bg-[var(--surface-strong)] disabled:opacity-50"
                      title="Remove channel"
                      aria-label={`Remove ${channel.name}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-xs" style={{ color: "var(--text-mute)" }}>
                  {channel.url}
                </p>
                {result && (
                  <p
                    className={`mt-2 flex items-center gap-2 text-xs ${result.ok ? "text-emerald-600" : "text-rose-600"}`}
                    role="status"
                  >
                    {result.ok ? <Check size={14} /> : <AlertCircle size={14} />} {result.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div>
          <label htmlFor="channel-kind" className={labelClass} style={labelStyle}>
            Channel
          </label>
          <SelectField
            id="channel-kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as NotificationChannelKind);
              setAddError(null);
            }}
            className="w-full rounded-xl px-4 py-2.5 text-sm"
            wrapperClassName="w-full"
            chevronSize={16}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </SelectField>
          <p className="mt-1 text-xs" style={{ color: "var(--text-mute)" }}>
            {spec.help}
          </p>
        </div>

        <div>
          <label htmlFor="channel-url" className={labelClass} style={labelStyle}>
            {spec.urlLabel}
          </label>
          <input
            id="channel-url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={spec.urlPlaceholder}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        {spec.tokenLabel && (
          <div>
            <label htmlFor="channel-token" className={labelClass} style={labelStyle}>
              {spec.tokenLabel}
            </label>
            <input
              id="channel-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <label htmlFor="channel-name" className={labelClass} style={labelStyle}>
            Name (optional)
          </label>
          <input
            id="channel-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={spec.label}
            className={inputClass}
            style={inputStyle}
          />
        </div>

        <button
          type="submit"
          disabled={adding || !url.trim() || (spec.tokenRequired && !token.trim())}
          className="btn-primary disabled:opacity-50"
        >
          {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add channel
        </button>

        {addError && (
          <p className="flex items-center gap-2 text-sm text-rose-600" role="alert">
            <AlertCircle size={16} /> {addError}
          </p>
        )}
      </form>
    </div>
  );
}
