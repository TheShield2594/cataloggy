import { api } from "../api";

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

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const subscribeToPush = async (): Promise<void> => {
  if (!isPushSupported()) {
    throw new Error("Push notifications are not supported in this browser");
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
    throw new Error("Browser did not return a usable push subscription");
  }

  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
};

export const unsubscribeFromPush = async (): Promise<void> => {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;

  await api.pushUnsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
};
