-- Covers the distinct-series scans that back /watch/stats/detailed and the Stremio
-- "recently watched series" catalog. The existing dedup index leads with
-- (profileId, type, imdbId) and so cannot answer DISTINCT/GROUP BY "seriesImdbId"
-- without falling back to the heap for every episode event in the profile.
CREATE INDEX CONCURRENTLY "idx_watchevent_series" ON "WatchEvent"("profileId", "type", "seriesImdbId");
