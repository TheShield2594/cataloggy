-- Lightweight PIN-protected profiles so household members sharing one
-- Cataloggy instance (one shared API token) get separate watch
-- history/lists/stats. This drops the vestigial, unreferenced User table
-- and adds a Profile table that becomes the new scoping key for all
-- per-household data.

DROP TABLE IF EXISTS "User";

CREATE TABLE "Profile" (
    "id"        UUID NOT NULL,
    "name"      TEXT NOT NULL,
    "pinHash"   TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- Seed a default, PIN-less profile so existing single-tenant data can be
-- backfilled onto it below without violating the NOT NULL constraints we
-- are about to add.
INSERT INTO "Profile" ("id", "name", "pinHash")
VALUES ('00000000-0000-4000-8000-000000000001', 'Default', NULL);

-- ─── List ───

ALTER TABLE "List" ADD COLUMN "profileId" UUID;
UPDATE "List" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "List" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "List" ADD CONSTRAINT "List_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "List_profileId_idx" ON "List"("profileId");

-- ─── WatchEvent ───

ALTER TABLE "WatchEvent" ADD COLUMN "profileId" UUID;
UPDATE "WatchEvent" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "WatchEvent" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "WatchEvent" ADD CONSTRAINT "WatchEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "WatchEvent_profileId_idx" ON "WatchEvent"("profileId");

-- ─── SeriesProgress ───
-- Primary key changes from a singular seriesImdbId to (profileId, seriesImdbId).

ALTER TABLE "SeriesProgress" ADD COLUMN "profileId" UUID;
UPDATE "SeriesProgress" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "SeriesProgress" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "SeriesProgress" DROP CONSTRAINT "SeriesProgress_pkey";
ALTER TABLE "SeriesProgress" ADD CONSTRAINT "SeriesProgress_pkey" PRIMARY KEY ("profileId", "seriesImdbId");
ALTER TABLE "SeriesProgress" ADD CONSTRAINT "SeriesProgress_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── PushSubscription ───

ALTER TABLE "PushSubscription" ADD COLUMN "profileId" UUID;
UPDATE "PushSubscription" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "PushSubscription" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PushSubscription_profileId_idx" ON "PushSubscription"("profileId");

-- ─── NotifiedEpisode ───
-- Unique constraint widens from (seriesImdbId, season, episode) to include profileId.

ALTER TABLE "NotifiedEpisode" ADD COLUMN "profileId" UUID;
UPDATE "NotifiedEpisode" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "NotifiedEpisode" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "NotifiedEpisode" ADD CONSTRAINT "NotifiedEpisode_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "NotifiedEpisode_seriesImdbId_season_episode_key";
CREATE UNIQUE INDEX "NotifiedEpisode_profileId_seriesImdbId_season_episode_key" ON "NotifiedEpisode"("profileId", "seriesImdbId", "season", "episode");

-- ─── ScrobbleSession ───

ALTER TABLE "ScrobbleSession" ADD COLUMN "profileId" UUID;
UPDATE "ScrobbleSession" SET "profileId" = '00000000-0000-4000-8000-000000000001' WHERE "profileId" IS NULL;
ALTER TABLE "ScrobbleSession" ALTER COLUMN "profileId" SET NOT NULL;
ALTER TABLE "ScrobbleSession" ADD CONSTRAINT "ScrobbleSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ScrobbleSession_profileId_idx" ON "ScrobbleSession"("profileId");
