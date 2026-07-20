-- Part 2/3 of the WatchEvent hot-path index rework. Covers /watch/history and
-- /watch/stats/* ordering/filtering by profileId + watchedAt.
CREATE INDEX CONCURRENTLY "WatchEvent_profileId_watchedAt_idx" ON "WatchEvent"("profileId", "watchedAt");
