// Fan-out across every notification target a profile has configured: web push
// plus whatever channels (ntfy, Gotify, Discord, generic webhook) it has added.
//
// The channels exist because web push has prerequisites a LAN self-host often
// can't meet (VAPID keys, https, an installed home-screen app on iOS), so the
// two are peers rather than a primary and a fallback — a profile can have
// either, both, or several of each.

import { prisma } from "./prisma.js";
import { sendPushToAllSubscriptions } from "./push.js";
import { listEnabledChannels, sendToChannel } from "./notification-channels.js";
import type { NotificationEvent } from "./notification-channels.js";

export type DeliveryResult = {
  /** Targets that were tried: web push counts as one, plus one per channel. */
  attempted: number;
  delivered: number;
  failures: Error[];
};

const asError = (error: unknown, label: string): Error =>
  error instanceof Error
    ? new Error(`${label}: ${error.message}`, { cause: error })
    : new Error(`${label}: ${String(error)}`);

/**
 * Profiles with at least one way to be notified. The scheduled job only has to
 * look for upcoming episodes for these — computing them for a profile nothing
 * could be sent to is wasted work.
 */
export const getNotifiableProfileIds = async (): Promise<string[]> => {
  const [pushProfiles, channelProfiles] = await Promise.all([
    prisma.pushSubscription.findMany({ select: { profileId: true }, distinct: ["profileId"] }),
    prisma.notificationChannel.findMany({
      where: { enabled: true },
      select: { profileId: true },
      distinct: ["profileId"],
    }),
  ]);

  return [...new Set([...pushProfiles.map((p) => p.profileId), ...channelProfiles.map((c) => c.profileId)])];
};

/**
 * Sends `event` to every target configured for `profileId`. Never throws: one
 * dead channel must not stop the others, so the outcome is reported instead —
 * the caller decides what a partial delivery means.
 */
export const deliverNotification = async (
  event: NotificationEvent,
  profileId: string
): Promise<DeliveryResult> => {
  const [pushCount, channels] = await Promise.all([
    prisma.pushSubscription.count({ where: { profileId } }),
    listEnabledChannels(profileId),
  ]);

  const failures: Error[] = [];
  let attempted = 0;
  let delivered = 0;

  // All of a profile's push subscriptions are one target: sendPushToAllSubscriptions
  // already treats them as a set, dropping the ones the browser has expired and
  // raising if any live one fails.
  if (pushCount > 0) {
    attempted += 1;
    try {
      await sendPushToAllSubscriptions(
        { title: event.title, body: event.body, url: event.path },
        profileId
      );
      delivered += 1;
    } catch (error) {
      failures.push(asError(error, "web push"));
    }
  }

  const results = await Promise.allSettled(channels.map((channel) => sendToChannel(channel, event)));
  results.forEach((result, index) => {
    attempted += 1;
    if (result.status === "fulfilled") {
      delivered += 1;
    } else {
      failures.push(asError(result.reason, `${channels[index].kind} channel`));
    }
  });

  return { attempted, delivered, failures };
};
