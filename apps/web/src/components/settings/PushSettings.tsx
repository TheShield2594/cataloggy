import { useEffect, useState } from "react";
import { api } from "../../api";
import { Loader2, AlertCircle, Unplug, Bell } from "lucide-react";
import { isPushSupported, getExistingPushSubscription, subscribeToPush, unsubscribeFromPush } from "../../utils/push";
import { StatusBadge } from "./StatusBadge";

export function PushSettings() {
  const supported = isPushSupported();
  const [loading, setLoading] = useState(supported);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const existing = await getExistingPushSubscription();
        setSubscribed(!!existing);
        if (existing) {
          // The server may have dropped this subscription (e.g. a failed
          // send cleaned it up), so re-register it to keep both sides in
          // sync. Best-effort: a failure here doesn't affect the toggle.
          const json = existing.toJSON();
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            await api
              .pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
              .catch(() => {});
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await subscribeToPush();
      setSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable notifications");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <p className="text-sm text-ink-600">Push notifications aren't supported in this browser.</p>;
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-ink-600"><Loader2 size={16} className="animate-spin" /> Checking notification status...</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600 leading-relaxed">
        Get a push notification when the next episode of a series you're tracking airs.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge ok={subscribed} label={subscribed ? "Enabled" : "Disabled"} />
      </div>

      <button
        type="button"
        onClick={subscribed ? disable : enable}
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
          subscribed
            ? "bg-ink-100 border border-ink-200 text-ink-700 hover:bg-rose-600 hover:text-white"
            : "bg-claw-500 text-white hover:bg-claw-600 shadow-lg shadow-claw-500/20"
        }`}
      >
        {busy ? (
          <><Loader2 size={16} className="animate-spin" /> {subscribed ? "Disabling..." : "Enabling..."}</>
        ) : subscribed ? (
          <><Unplug size={16} /> Disable Notifications</>
        ) : (
          <><Bell size={16} /> Enable Notifications</>
        )}
      </button>

      {error && <p className="flex items-center gap-2 text-sm text-rose-400"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}
