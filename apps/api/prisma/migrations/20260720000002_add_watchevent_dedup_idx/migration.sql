-- Part 3/3 of the WatchEvent hot-path index rework. Covers `recordWatchEvent`'s dedup
-- check (profileId + type + imdbId, plus season/episode for episodes), which runs on
-- every scrobble/webhook watch event and previously had to scan every event for the
-- profile since the old index was profileId-only.
CREATE INDEX CONCURRENTLY "idx_watchevent_dedup" ON "WatchEvent"("profileId", "type", "imdbId", "season", "episode");
