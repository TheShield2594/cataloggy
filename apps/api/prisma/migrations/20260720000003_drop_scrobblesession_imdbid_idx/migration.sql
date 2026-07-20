-- Part 1/3 of the ScrobbleSession hot-path index rework. One statement per migration —
-- see the note in 20260720000000_drop_watchevent_profileid_idx for why.
--
-- Superseded by ScrobbleSession_profileId_imdbId_season_episode_status_idx (added in
-- the final migration of this set), which covers /scrobble/start, /pause, and /stop —
-- all of which filter on profileId + imdbId + season + episode + status together, a
-- combination neither of the two old indexes covered on its own.
DROP INDEX CONCURRENTLY "ScrobbleSession_imdbId_season_episode_status_idx";
