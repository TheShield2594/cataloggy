/**
 * Where a notification goes: the browser itself, or a channel the user
 * already runs.
 */

import { request } from "./client";
import type {
  NotificationChannel,
  NotificationChannelKind,
  OutboundFailure,
} from "./types";

export const notificationsApi = {
  // Push notifications
  getPushPublicKey() {
    return request<{ publicKey: string }>("/push/public-key");
  },
  pushSubscribe(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return request<{ subscribed: boolean }>("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
    });
  },
  pushUnsubscribe(endpoint: string) {
    return request<{ subscribed: boolean }>("/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  },
  // Notification channels (ntfy, Gotify, Discord, generic webhook)
  getNotificationChannels() {
    return request<{ channels: NotificationChannel[] }>("/notifications/channels");
  },
  createNotificationChannel(payload: {
    kind: NotificationChannelKind;
    name?: string | undefined;
    url: string;
    token?: string | undefined;
  }) {
    return request<{ channel: NotificationChannel }>("/notifications/channels", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  // Omitting `token` keeps the stored one; an empty string clears it.
  updateNotificationChannel(
    id: string,
    payload: { name?: string | undefined; url?: string | undefined; token?: string | undefined; enabled?: boolean | undefined }
  ) {
    return request<{ channel: NotificationChannel }>(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  deleteNotificationChannel(id: string) {
    return request<{ deleted: boolean }>(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  testNotificationChannel(id: string) {
    return request<{ success: boolean; outcome?: OutboundFailure | undefined; error?: string | undefined }>(
      `/notifications/channels/${encodeURIComponent(id)}/test`,
      { method: "POST", timeoutMs: 20000 }
    );
  },
};
