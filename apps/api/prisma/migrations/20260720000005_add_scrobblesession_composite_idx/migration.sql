-- Part 3/3 of the ScrobbleSession hot-path index rework.
CREATE INDEX CONCURRENTLY "ScrobbleSession_profileId_imdbId_season_episode_status_idx" ON "ScrobbleSession"("profileId", "imdbId", "season", "episode", "status");
