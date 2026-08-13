// Outbound notification channels that aren't web push.
//
// Web push is the one part of Cataloggy a plain `http://192.168.1.25` LAN
// deployment genuinely cannot do: it needs VAPID keys, browsers refuse
// service-worker push over plain http, and iOS only delivers to a site that was
// added to the home screen first. Every channel here is a single HTTP POST to a
// URL the user already has — a self-hosted ntfy or Gotify, a Discord webhook,
// or anything else that accepts JSON (Home Assistant, Slack, n8n).
//
// The four differ only in how the request is shaped, so `buildChannelRequest`
// is a pure function of (channel, event) and `sendToChannel` is the one place
// that talks to the network.
//
// SECURITY: the URL is user-supplied and POSTed to by a background job, so it
// gets the same treatment as the AI provider endpoint — validated on save, and
// re-resolved immediately before every request, since DNS can change after a
// channel is stored. Redirects are refused rather than followed, so an allowed
// host can't bounce the request somewhere the validator would have rejected.

import type { NotificationChannelKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { SECRET_CONTEXT, decryptSecret } from "./secret-box.js";
import { resolveNotificationUrl } from "./ssrf.js";

export const NOTIFICATION_CHANNEL_KINDS = ["ntfy", "gotify", "discord", "webhook"] as const;

export const isNotificationChannelKind = (value: unknown): value is NotificationChannelKind =>
  typeof value === "string" && (NOTIFICATION_CHANNEL_KINDS as readonly string[]).includes(value);

/**
 * The persisted fields a send needs. `token` is whatever the column holds, so
 * it arrives encrypted — `sendToChannel` opens it, and `buildChannelRequest`
 * only ever sees the plaintext it is about to put in a header.
 */
export type ChannelTarget = {
  id: string;
  kind: NotificationChannelKind;
  name: string;
  url: string;
  token: string | null;
};

export type NotificationEvent = {
  /** Machine-readable name, sent to generic webhooks so a receiver can branch on it. */
  event: string;
  title: string;
  body: string;
  /** App-relative path the notification links to, e.g. "/calendar". */
  path?: string;
  /** Structured detail for generic webhooks; ignored by the text-shaped channels. */
  data?: Record<string, unknown>;
};

const SEND_TIMEOUT_MS = 10_000;

// Deep links can only be built when the deployment has told the API where the
// web UI lives. Without it the notification still goes out, just without a link
// — better than shipping a relative path that resolves against ntfy.sh.
const WEB_PUBLIC_BASE = (process.env.CATALOGGY_WEB_PUBLIC ?? process.env.WEB_PUBLIC_BASE)?.replace(/\/+$/, "");

const absoluteLink = (path?: string): string | undefined => {
  if (!path || !WEB_PUBLIC_BASE) return undefined;
  return `${WEB_PUBLIC_BASE}${path.startsWith("/") ? path : `/${path}`}`;
};

// HTTP header values are latin1 at best — undici rejects anything outside it —
// and ntfy carries the notification's title in one. A series called "Pokémon"
// would therefore throw before the request left. RFC 2047 encoded words are
// what ntfy documents for exactly this, so use them whenever the value isn't
// plain ASCII.
export const encodeHeaderValue = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;

// Gotify takes the message at /message on the server root, but people paste
// whichever of the two they have in front of them, and a reverse proxy can put
// the whole server under a path prefix — so append rather than rebuild from the
// origin, and don't append twice.
const gotifyMessageUrl = (raw: string): string => {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/message") ? trimmed : `${trimmed}/message`;
};

export type ChannelRequest = { url: string; init: RequestInit };

/**
 * The HTTP request that delivers `event` over `channel`. Pure — no network, no
 * SSRF resolution — so the per-channel payload shapes are testable on their own.
 */
export const buildChannelRequest = (channel: ChannelTarget, event: NotificationEvent): ChannelRequest => {
  const link = absoluteLink(event.path);

  switch (channel.kind) {
    case "ntfy":
      return {
        url: channel.url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            Title: encodeHeaderValue(event.title),
            Tags: "tv",
            ...(link ? { Click: link } : {}),
            ...(channel.token ? { Authorization: `Bearer ${channel.token}` } : {}),
          },
          body: event.body,
        },
      };

    case "gotify":
      return {
        url: gotifyMessageUrl(channel.url),
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(channel.token ? { "X-Gotify-Key": channel.token } : {}),
          },
          body: JSON.stringify({
            title: event.title,
            message: event.body,
            priority: 5,
            // Gotify's Android client reads the tap target out of this extra;
            // clients that don't understand it ignore it.
            ...(link ? { extras: { "client::notification": { click: { url: link } } } } : {}),
          }),
        },
      };

    case "discord":
      return {
        url: channel.url,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "Cataloggy",
            embeds: [
              {
                title: event.title,
                description: event.body,
                // Discord rejects an embed whose url isn't absolute, so it is
                // present only when the deployment knows its own web URL.
                ...(link ? { url: link } : {}),
                color: 0xf97316,
              },
            ],
          }),
        },
      };

    case "webhook":
      return {
        url: channel.url,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(channel.token ? { Authorization: `Bearer ${channel.token}` } : {}),
          },
          // A receiver here is a script or an automation platform rather than a
          // notifier, so it gets the event itself: the rendered text for the
          // simple case, and the structured fields for anything that wants to
          // route on them.
          body: JSON.stringify({
            event: event.event,
            title: event.title,
            message: event.body,
            url: link ?? event.path ?? null,
            data: event.data ?? {},
          }),
        },
      };
  }
};

/**
 * Delivers `event` over `channel`. Throws on anything that isn't a 2xx, on a
 * URL that no longer resolves to an allowed target, and on a timeout.
 */
export const sendToChannel = async (channel: ChannelTarget, event: NotificationEvent): Promise<void> => {
  // Sending without the token would reach the server and be rejected there,
  // hours later and reported as a plain 401 — naming the actual cause is worth
  // more than an attempt that cannot succeed.
  const token = channel.token === null ? null : decryptSecret(SECRET_CONTEXT.notificationChannelToken, channel.token);
  if (channel.token !== null && token === null) {
    throw new Error(
      `${channel.name}: stored token could not be decrypted — API_TOKEN has changed since it was saved. Re-enter the token in Settings.`
    );
  }

  const request = buildChannelRequest({ ...channel, token }, event);

  // Resolved here rather than trusting the save-time check: the channel may
  // have been stored months ago, and the name could point somewhere else now.
  if (!(await resolveNotificationUrl(request.url))) {
    throw new Error(`${channel.name}: URL resolves to an address that is not an allowed outbound target`);
  }

  const response = await fetch(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    // An allowed host must not be able to bounce this request to an internal
    // address the validator would have rejected.
    redirect: "error",
  });

  if (!response.ok) {
    // Deliberately without the response body: echoing it back would turn a
    // notification channel into an SSRF probe with a readable answer.
    throw new Error(`${channel.name}: HTTP ${response.status}`);
  }
};

export const listEnabledChannels = async (profileId: string): Promise<ChannelTarget[]> =>
  prisma.notificationChannel.findMany({
    where: { profileId, enabled: true },
    select: { id: true, kind: true, name: true, url: true, token: true },
    orderBy: { createdAt: "asc" },
  });
