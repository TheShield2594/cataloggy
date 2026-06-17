-- Web Push subscriptions registered by browsers that opted in to episode
-- air-date reminders, and a dedup ledger so the periodic "next episode
-- airs today" check never sends the same episode notification twice.
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE TABLE "NotifiedEpisode" (
    "id" UUID NOT NULL,
    "seriesImdbId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "episode" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotifiedEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotifiedEpisode_seriesImdbId_season_episode_key" ON "NotifiedEpisode"("seriesImdbId", "season", "episode");
