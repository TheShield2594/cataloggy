-- Add an idempotency key for Trakt history sync. Each Trakt /sync/history
-- entry has a stable numeric `id`; storing it lets repeated polls/imports
-- recognize an already-recorded entry instead of creating a duplicate
-- WatchEvent or incrementing plays again.
ALTER TABLE "WatchEvent" ADD COLUMN "traktHistoryId" BIGINT;

CREATE UNIQUE INDEX "WatchEvent_traktHistoryId_key" ON "WatchEvent"("traktHistoryId");
