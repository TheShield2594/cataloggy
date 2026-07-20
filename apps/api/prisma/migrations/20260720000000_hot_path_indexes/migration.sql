-- Performance: cover the hottest write/read paths with indexes that actually match
-- their query shape.
--
-- WatchEvent: `recordWatchEvent` (the dedup check run on every scrobble/webhook watch
-- event) filters on profileId + type + imdbId (+ season/episode for episodes) — the
-- old profileId-only index left Postgres scanning every event for the profile. The
-- new composite index also covers /watch/history and /watch/stats/* ordering/filtering
-- by profileId + watchedAt, so the old plain profileId index is now redundant (it's a
-- prefix of the new one) and is dropped to avoid the extra write-time index maintenance.
DROP INDEX "WatchEvent_profileId_idx";
CREATE INDEX "WatchEvent_profileId_watchedAt_idx" ON "WatchEvent"("profileId", "watchedAt");
CREATE INDEX "idx_watchevent_dedup" ON "WatchEvent"("profileId", "type", "imdbId", "season", "episode");

-- ScrobbleSession: /scrobble/start, /pause, and /stop all filter on
-- profileId + imdbId + season + episode + status together (hit on every playback
-- start/pause/stop from Plex/Jellyfin), which neither of the old two indexes covered
-- on their own.
DROP INDEX "ScrobbleSession_imdbId_season_episode_status_idx";
DROP INDEX "ScrobbleSession_profileId_idx";
CREATE INDEX "ScrobbleSession_profileId_imdbId_season_episode_status_idx" ON "ScrobbleSession"("profileId", "imdbId", "season", "episode", "status");
