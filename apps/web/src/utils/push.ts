import { api } from "../api";
import { isStandalone } from "./displayMode";

// Web Push delivers VAPID keys as URL-safe base64; PushManager.subscribe
// needs them as a raw Uint8Array.
const urlBase64ToUint8Array = (base64: string): Uint8Array<ArrayBuffer> => {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const bytes = new Uint8Array(raw.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

export const isPushSupported = (): boolean =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/**
 * Why the APIs are missing, when they are.
 *
 * `isPushSupported()` answers "can this page subscribe", which is the question
 * the code has — but it is not the question the person looking at Settings has,
 * and "not supported in this browser" is the wrong answer to theirs twice over.
 * On a plain-http LAN install no browser would support it; on iOS the very same
 * Safari supports it perfectly once the app is on the Home Screen. Both are
 * things the user can fix, and neither is fixed by changing browser.
 */
export type PushAvailability =
  | "available"
  /** No service workers, no notifications: a non-https origin. */
  | "insecure-context"
  /** iOS/iPadOS in a tab. Web Push exists there only for home-screen apps. */
  | "ios-needs-home-screen"
  /** Genuinely a browser without Web Push. */
  | "unsupported";

/**
 * True on iPhone and iPad, including the "Request Desktop Site" case.
 *
 * iPadOS 13 and up send a desktop Safari user agent by default, so the classic
 * device test misses every iPad. A Macintosh UA that reports touch points is
 * one: no actual Mac does.
 */
export const isIosOrIpadOs = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export const getPushAvailability = (): PushAvailability => {
  if (isPushSupported()) return "available";
  // Checked before the platform, because it is the one that stops the others
  // from being true: on `http://192.168.x.x` iOS has no service worker either,
  // and sending that user to Add to Home Screen wouldn't help.
  if (!window.isSecureContext) return "insecure-context";
  if (isIosOrIpadOs() && !isStandalone()) return "ios-needs-home-screen";
  return "unsupported";
};

/** The browser's notification permission, or `null` where there is no API. */
export const getNotificationPermission = (): NotificationPermission | null =>
  "Notification" in window ? Notification.permission : null;

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const subscribeToPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported in this browser");
  }

  // A permission that is already denied is not a prompt that gets declined:
  // `requestPermission()` resolves instantly, with no browser UI at all, so
  // the generic message below reads as the button having quietly done nothing.
  // The way back is in the browser's own site settings, and nothing else in
  // this app can open it — so say so.
  if (Notification.permission === "denied") {
    throw new Error(
      "Notifications are blocked for this site in your browser. Allow them in its site settings — " +
        "the padlock or ⓘ next to the address — then try again."
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted");
  }

  const { publicKey } = await api.getPushPublicKey();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    await subscription.unsubscribe();
    throw new Error("Browser did not return a usable push subscription");
  }

  try {
    await api.pushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
  } catch (error) {
    // Don't leave the browser locally subscribed if the server never
    // learned about it — it would never receive a notification anyway.
    await subscription.unsubscribe();
    throw error;
  }
};

export const unsubscribeFromPush = async (): Promise<void> => {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;

  await api.pushUnsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
};
