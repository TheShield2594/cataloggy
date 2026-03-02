ALTER TABLE "SeriesProgress"
ADD COLUMN "lastWatchedAt" TIMESTAMPTZ(6);

UPDATE "SeriesProgress"
SET "lastWatchedAt" = "updatedAt"
WHERE "lastWatchedAt" IS NULL;

ALTER TABLE "SeriesProgress"
ALTER COLUMN "lastWatchedAt" SET NOT NULL;
