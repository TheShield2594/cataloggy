import { useEffect, useState } from "react";
import { api } from "../../api";
import { Loader2, AlertCircle, Unplug, Bell, BellOff } from "lucide-react";
import {
  getNotificationPermission,
  getPushAvailability,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "../../utils/push";
import { StatusBadge } from "./StatusBadge";

export function PushSettings() {
  const availability = getPushAvailability();
  const supported = availability === "available";
  const [loading, setLoading] = useState(supported);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read up front rather than discovered by pressing the button. A permission
  // that is already "denied" makes `requestPermission()` a no-op, so without
  // this the only feedback for a blocked site is an error message printed after
  // a click that visibly did nothing.
  const [permission, setPermission] = useState(getNotificationPermission);

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
      // The prompt this may have just shown is how permission goes from
      // "default" to "granted" or "denied" — re-read it either way, so a Block
      // turns the button into the explanation below instead of leaving it
      // inviting another press that can no longer show anything.
      setPermission(getNotificationPermission());
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

  // The APIs go missing for three very different reasons, and blaming the
  // browser for all of them sends people to try another one — which fixes
  // exactly one of the three.
  if (availability === "insecure-context") {
    // On a plain `http://192.168.x.x` install — the address the README's LAN
    // quickstart hands out — `navigator.serviceWorker` is absent no matter how
    // modern the browser is, because the origin isn't secure.
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Push needs Cataloggy on an <strong>https://</strong> address (or localhost) — browsers
        switch off service workers and notifications on a plain http one, so this has nothing to
        do with your browser. Put Cataloggy behind a reverse proxy with a certificate to enable
        it, or add a notification channel below — ntfy, Gotify, Discord or a webhook all deliver
        the same alerts over plain http.
      </p>
    );
  }

  if (availability === "ios-needs-home-screen") {
    // Safari has had Web Push since iOS 16.4, but only for apps added to the
    // Home Screen: in a tab the APIs simply aren't there. That is a two-tap fix
    // and nothing about the browser, so it must not read as one.
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        On iPhone and iPad, notifications need Cataloggy on your Home Screen — Safari doesn&apos;t
        offer them to a tab. Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>,
        open Cataloggy from there and come back to this page to turn them on. (Needs iOS 16.4 or
        later; on anything older, use a notification channel below instead.)
      </p>
    );
  }

  if (!supported) {
    return <p className="text-sm" style={{ color: "var(--text-dim)" }}>Push notifications aren&apos;t supported in this browser.</p>;
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-dim)" }}><Loader2 size={16} className="animate-spin" /> Checking notification status...</div>;
  }

  // Blocked at the browser level. Enabling cannot work and pressing the button
  // cannot even ask — but a subscription made before the block was applied still
  // exists, and turning *that* off is a request to the server this app can still
  // make, so the button only goes away when there is nothing left for it to do.
  const blocked = permission === "denied" && !subscribed;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
        Get a push notification when the next episode of a series you're tracking airs.
      </p>

      <div className="flex items-center gap-3">
        <StatusBadge ok={subscribed} label={subscribed ? "Enabled" : blocked ? "Blocked" : "Disabled"} />
      </div>

      {blocked ? (
        <p className="flex items-start gap-2 text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
          <BellOff size={16} className="mt-0.5 flex-none" aria-hidden="true" />
          <span>
            Your browser is blocking notifications for this site, so Cataloggy can&apos;t ask for
            them — the permission prompt never appears once it&apos;s been denied. Allow
            notifications in the site settings behind the padlock or ⓘ in the address bar (on
            Android Chrome: the ⋮ menu, then Settings &rsaquo; Site settings), then reload this
            page.
          </span>
        </p>
      ) : (
        <button
          type="button"
          onClick={subscribed ? disable : enable}
          disabled={busy}
          // Utilities outrank the .btn-secondary hover, so the destructive hover
          // lands without needing !important.
          className={subscribed ? "btn-secondary hover:bg-rose-600 hover:text-white" : "btn-primary"}
        >
          {busy ? (
            <><Loader2 size={16} className="animate-spin" /> {subscribed ? "Disabling..." : "Enabling..."}</>
          ) : subscribed ? (
            <><Unplug size={16} /> Disable Notifications</>
          ) : (
            <><Bell size={16} /> Enable Notifications</>
          )}
        </button>
      )}

      {error && <p role="alert" className="flex items-center gap-2 text-sm text-danger"><AlertCircle size={16} /> {error}</p>}
    </div>
  );
}
