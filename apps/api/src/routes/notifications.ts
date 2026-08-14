import type { FastifyPluginAsync } from "fastify";
import type { NotificationChannelKind } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { SECRET_CONTEXT, encryptSecret } from "../lib/secret-box.js";
import { validateNotificationUrl } from "../lib/ssrf.js";
import { UUID_V4_PATTERN } from "../lib/types.js";
import {
  NOTIFICATION_CHANNEL_KINDS,
  isNotificationChannelKind,
  sendToChannel,
} from "../lib/notification-channels.js";

// A ceiling rather than a considered limit: nobody needs ten notification
// targets per profile, and without one a loop bug in a client could fill the
// table (and then POST to every row on every check).
const MAX_CHANNELS_PER_PROFILE = 10;
const MAX_NAME_LENGTH = 60;
const MAX_TOKEN_LENGTH = 500;

const DEFAULT_NAMES: Record<NotificationChannelKind, string> = {
  ntfy: "ntfy",
  gotify: "Gotify",
  discord: "Discord",
  webhook: "Webhook",
};

const URL_ERROR =
  "url must be an http(s) URL and must not target the cloud-metadata/link-local range";

// `NotificationChannel.id` is a uuid column, so a malformed id is rejected by
// Postgres rather than simply matching nothing — an unhandled driver error and
// a 500 where the caller sent a bad request. Authorization never depended on
// this (the `profileId` filter is on every query here); it is the difference
// between a 400 and a logged exception.
const CHANNEL_ID_ERROR = "id must be a valid UUID";

// The token is write-only: it is a credential for someone else's server, and
// nothing in the UI needs it back — only whether one is set.
const publicChannel = (channel: {
  id: string;
  kind: NotificationChannelKind;
  name: string;
  url: string;
  token: string | null;
  enabled: boolean;
  createdAt: Date;
}) => ({
  id: channel.id,
  kind: channel.kind,
  name: channel.name,
  url: channel.url,
  hasToken: !!channel.token,
  enabled: channel.enabled,
  createdAt: channel.createdAt.toISOString(),
});

/**
 * Rules a channel's URL/token have to satisfy beyond being a safe outbound
 * target. Returns an error message, or null when the pair is usable.
 *
 * Takes `hasToken` rather than the token itself: nothing here depends on the
 * value, and on a PATCH that leaves the token alone the only thing in hand is
 * the stored ciphertext.
 */
const validateForKind = (kind: NotificationChannelKind, url: string, hasToken: boolean): string | null => {
  const parsed = validateNotificationUrl(url);
  if (!parsed) return URL_ERROR;

  // ntfy publishes to a topic, and the topic is the path — posting to the bare
  // server would 404 at send time, hours later and out of sight.
  if (kind === "ntfy" && parsed.pathname.replace(/\/+$/, "").length <= 1) {
    return "url must include the topic, e.g. https://ntfy.sh/my-topic";
  }
  // Gotify rejects an unauthenticated /message outright, so a missing token is
  // a guaranteed failure worth catching at save time.
  if (kind === "gotify" && !hasToken) {
    return "token is required for Gotify (an application token)";
  }
  return null;
};

type ChannelBody = {
  kind?: unknown;
  name?: unknown;
  url?: unknown;
  token?: unknown;
  enabled?: unknown;
};

const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/notifications/channels", { preHandler: resolveProfile }, async (request) => {
    const channels = await prisma.notificationChannel.findMany({
      where: { profileId: request.profileId! },
      orderBy: { createdAt: "asc" },
    });
    return { channels: channels.map(publicChannel) };
  });

  app.post<{ Body: unknown }>("/notifications/channels", { preHandler: resolveProfile }, async (request, reply) => {
    const body = request.body as ChannelBody | null;

    if (!isNotificationChannelKind(body?.kind)) {
      return reply.code(400).send({ error: `kind must be one of: ${NOTIFICATION_CHANNEL_KINDS.join(", ")}` });
    }
    const kind = body.kind;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const token = typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;

    const problem = validateForKind(kind, url, !!token);
    if (problem) return reply.code(400).send({ error: problem });
    if (token && token.length > MAX_TOKEN_LENGTH) {
      return reply.code(400).send({ error: `token must be at most ${MAX_TOKEN_LENGTH} characters` });
    }

    const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : DEFAULT_NAMES[kind]).slice(
      0,
      MAX_NAME_LENGTH
    );

    const existing = await prisma.notificationChannel.count({ where: { profileId: request.profileId! } });
    if (existing >= MAX_CHANNELS_PER_PROFILE) {
      return reply
        .code(400)
        .send({ error: `A profile can have at most ${MAX_CHANNELS_PER_PROFILE} notification channels` });
    }

    const channel = await prisma.notificationChannel.create({
      data: {
        kind,
        name,
        url,
        token: token && encryptSecret(SECRET_CONTEXT.notificationChannelToken, token),
        enabled: body.enabled === undefined ? true : body.enabled !== false,
        profileId: request.profileId!,
      },
    });

    return reply.code(201).send({ channel: publicChannel(channel) });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/notifications/channels/:id",
    { preHandler: resolveProfile },
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.id)) {
        return reply.code(400).send({ error: CHANNEL_ID_ERROR });
      }
      const body = request.body as ChannelBody | null;
      const existing = await prisma.notificationChannel.findFirst({
        where: { id: request.params.id, profileId: request.profileId! },
      });
      if (!existing) return reply.code(404).send({ error: "Channel not found" });

      const url = typeof body?.url === "string" ? body.url.trim() : existing.url;
      // An empty string clears a stored token; omitting the field keeps it,
      // which is what the UI sends back when it never saw the token to begin with.
      const newToken =
        body?.token === undefined
          ? undefined
          : typeof body.token === "string" && body.token.trim()
            ? body.token.trim()
            : null;
      // Kept tokens stay as they are on disk — already encrypted, and nothing
      // here needs to read one back to decide whether the channel is valid.
      const token =
        newToken === undefined
          ? existing.token
          : newToken && encryptSecret(SECRET_CONTEXT.notificationChannelToken, newToken);

      const problem = validateForKind(existing.kind, url, !!token);
      if (problem) return reply.code(400).send({ error: problem });
      if (newToken && newToken.length > MAX_TOKEN_LENGTH) {
        return reply.code(400).send({ error: `token must be at most ${MAX_TOKEN_LENGTH} characters` });
      }

      const channel = await prisma.notificationChannel.update({
        where: { id: existing.id },
        data: {
          url,
          token,
          ...(typeof body?.name === "string" && body.name.trim()
            ? { name: body.name.trim().slice(0, MAX_NAME_LENGTH) }
            : {}),
          ...(typeof body?.enabled === "boolean" ? { enabled: body.enabled } : {}),
        },
      });

      return { channel: publicChannel(channel) };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/notifications/channels/:id",
    { preHandler: resolveProfile },
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.id)) {
        return reply.code(400).send({ error: CHANNEL_ID_ERROR });
      }
      const { count } = await prisma.notificationChannel.deleteMany({
        where: { id: request.params.id, profileId: request.profileId! },
      });
      if (count === 0) return reply.code(404).send({ error: "Channel not found" });
      return { deleted: true };
    }
  );

  // Sending for real is the only check worth anything here: the failures people
  // hit are a wrong topic, a rejected token or a server that isn't reachable
  // from the container, and none of those are visible from the URL alone.
  app.post<{ Params: { id: string } }>(
    "/notifications/channels/:id/test",
    { preHandler: resolveProfile },
    async (request, reply) => {
      if (!UUID_V4_PATTERN.test(request.params.id)) {
        return reply.code(400).send({ error: CHANNEL_ID_ERROR });
      }
      const channel = await prisma.notificationChannel.findFirst({
        where: { id: request.params.id, profileId: request.profileId! },
      });
      if (!channel) return reply.code(404).send({ error: "Channel not found" });

      try {
        await sendToChannel(channel, {
          event: "test",
          title: "Cataloggy test notification",
          body: "If you can read this, Cataloggy can reach this channel.",
          path: "/settings",
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to send test notification",
        };
      }
    }
  );
};

export default notificationRoutes;
