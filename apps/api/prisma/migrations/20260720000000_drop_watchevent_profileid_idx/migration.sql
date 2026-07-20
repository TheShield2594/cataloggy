-- Part 1/3 of the WatchEvent hot-path index rework (see the following two migrations).
-- Prisma only skips wrapping a migration in a transaction when the file contains a
-- single statement, and CONCURRENTLY cannot run inside one — hence one statement per
-- migration here instead of a single combined file. CONCURRENTLY avoids taking an
-- exclusive lock on WatchEvent, which is written to on every scrobble/webhook event.
--
-- This plain index is superseded by WatchEvent_profileId_watchedAt_idx (next migration),
-- which is a superset (profileId is a prefix of profileId+watchedAt) and also covers
-- /watch/history and /watch/stats/* ordering/filtering by profileId + watchedAt.
DROP INDEX CONCURRENTLY "WatchEvent_profileId_idx";
