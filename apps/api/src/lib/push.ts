import webpush from "web-push";
import { prisma } from "./prisma.js";

const VAPID_PUBLIC_KEY_KV = "push:vapidPublicKey";
const VAPID_PRIVATE_KEY_KV = "push:vapidPrivateKey";
const VAPID_SUBJECT = "mailto:admin@cataloggy.local";

let configured: { publicKey: string } | null = null;

// VAPID keys identify this server to push services and never change once
// subscriptions exist against them, so generate one keypair on first use
// and persist it in KV rather than requiring it as deployment config.
const getOrCreateVapidKeys = async (): Promise<{ publicKey: string; privateKey: string }> => {
  const [publicRow, privateRow] = await Promise.all([
    prisma.kV.findUnique({ where: { key: VAPID_PUBLIC_KEY_KV } }),
    prisma.kV.findUnique({ where: { key: VAPID_PRIVATE_KEY_KV } }),
  ]);

  if (publicRow?.value && privateRow?.value) {
    return { publicKey: publicRow.value, privateKey: privateRow.value };
  }

  const generated = webpush.generateVAPIDKeys();
  const now = new Date();
  await Promise.all([
    prisma.kV.upsert({
      where: { key: VAPID_PUBLIC_KEY_KV },
      create: { key: VAPID_PUBLIC_KEY_KV, value: generated.publicKey, updatedAt: now },
      update: { value: generated.publicKey, updatedAt: now },
    }),
    prisma.kV.upsert({
      where: { key: VAPID_PRIVATE_KEY_KV },
      create: { key: VAPID_PRIVATE_KEY_KV, value: generated.privateKey, updatedAt: now },
      update: { value: generated.privateKey, updatedAt: now },
    }),
  ]);

  return generated;
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

export const sendPushToAllSubscriptions = async (payload: PushPayload): Promise<void> => {
  await getPushPublicKey();

  const subscriptions = await prisma.pushSubscription.findMany();
  if (subscriptions.length === 0) return;

  const json = JSON.stringify(payload);
  await Promise.allSettled(
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
};
