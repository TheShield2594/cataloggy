import webpush from "web-push";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const VAPID_KEYS_KV = "push:vapidKeys";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@cataloggy.local";

let configured: { publicKey: string } | null = null;

// VAPID keys identify this server to push services and never change once
// subscriptions exist against them, so generate one keypair on first use
// and persist it in KV rather than requiring it as deployment config.
// Both halves are stored as a single JSON row so concurrent first calls
// can't interleave and end up with a mismatched public/private pair.
const getOrCreateVapidKeys = async (): Promise<{ publicKey: string; privateKey: string }> => {
  const row = await prisma.kV.findUnique({ where: { key: VAPID_KEYS_KV } });
  if (row?.value) return JSON.parse(row.value);

  const generated = webpush.generateVAPIDKeys();
  try {
    await prisma.kV.create({
      data: { key: VAPID_KEYS_KV, value: JSON.stringify(generated), updatedAt: new Date() },
    });
    return generated;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another concurrent call already created the row; use that one.
      const existing = await prisma.kV.findUnique({ where: { key: VAPID_KEYS_KV } });
      if (existing?.value) return JSON.parse(existing.value);
    }
    throw error;
  }
};

export const getPushPublicKey = async (): Promise<string> => {
  const { publicKey, privateKey } = await getOrCreateVapidKeys();
  if (!configured) {
    webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
    configured = { publicKey };
  }
  return publicKey;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export const sendPushToAllSubscriptions = async (
  payload: PushPayload,
  profileId?: string
): Promise<void> => {
  await getPushPublicKey();

  const subscriptions = await prisma.pushSubscription.findMany(
    profileId ? { where: { profileId } } : undefined
  );
  if (subscriptions.length === 0) return;

  const json = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or was unregistered on the browser side.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          throw error;
        }
      }
    })
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      `${failures.length} of ${subscriptions.length} push notifications failed to send`
    );
  }
};
