-- Outbound notification targets that aren't web push: ntfy, Gotify, a Discord
-- webhook, or any URL that takes a JSON POST. Web push needs VAPID keys, https
-- and (on iOS) an installed home-screen app; a plain http://192.168.x.x
-- deployment has none of those, and most self-hosters already run one of these.
--
-- Per-profile like PushSubscription, so the notification job has the same
-- answer to "whose upcoming episodes" for both kinds of target.
CREATE TYPE "NotificationChannelKind" AS ENUM ('ntfy', 'gotify', 'discord', 'webhook');

CREATE TABLE "NotificationChannel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "NotificationChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    -- Topic URL for ntfy, server base URL for Gotify, full webhook URL for
    -- Discord and generic webhooks.
    "url" TEXT NOT NULL,
    -- Gotify application token / ntfy access token. Never read back out by the
    -- API, only sent upstream.
    "token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profileId" UUID NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationChannel_profileId_idx" ON "NotificationChannel"("profileId");

ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
