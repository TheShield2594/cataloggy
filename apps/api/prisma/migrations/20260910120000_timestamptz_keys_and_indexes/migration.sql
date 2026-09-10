-- Four pieces of schema hygiene that have accumulated across 35 migrations:
-- timestamps in two different types, two tables with no primary key, one index
-- that duplicates a primary key, and one periodic scan with no index at all.

-- ─── 1. Naive timestamps become timestamptz ───────────────────────────────
--
-- Nine columns were `timestamp without time zone` while the rest of the schema
-- (WatchEvent.watchedAt, Rating.ratedAt, CheckIn.startedAt, PlaySignal's three)
-- used `timestamptz`. A naive column stores wall-clock digits with no instant
-- attached, so what it means depends on who wrote it and when they read it back.
--
-- That mattered because every one of these is compared against a JS `Date`:
-- `lib/job-status.ts` prunes finished job runs by cutoff, `getDefaultProfileId`
-- orders profiles by `createdAt`, list items page by `addedAt`. Those comparisons
-- were correct only while both the API process and the database session ran in
-- UTC — which is true of the documented deployment (`node:26-alpine` sets no TZ,
-- and neither does the `postgres:16` image) and which nothing anywhere enforced.
-- Setting TZ on the api service, or on the host a bind-mounted database inherits,
-- was enough to make a "last 30 days" filter quietly off by the offset.
--
-- `AT TIME ZONE 'UTC'` reads each existing value as the UTC instant it was
-- written as, which is what both writers produced: node-postgres sends a Date
-- with an offset that a `timestamp` column then discards, keeping the process's
-- wall clock, and `DEFAULT CURRENT_TIMESTAMP` keeps the database session's. Both
-- are UTC unless someone changed TZ. If you did run with a non-UTC TZ, these
-- columns shift by that offset here — they were already being read as UTC by the
-- code, so this makes storage agree with what was assumed rather than changing
-- the meaning.
--
-- Rewrites each table: `Item` and `ListItem` are the large ones, and a library
-- of any realistic size still measures in seconds.
ALTER TABLE "Profile"  ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Item"     ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "List"     ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ListItem" ALTER COLUMN "addedAt"   TYPE timestamptz(6) USING "addedAt"   AT TIME ZONE 'UTC';
ALTER TABLE "KV"       ALTER COLUMN "updatedAt" TYPE timestamptz(6) USING "updatedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Tag"      ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "ItemTag"  ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Game"     ALTER COLUMN "createdAt" TYPE timestamptz(6) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Game"     ALTER COLUMN "updatedAt" TYPE timestamptz(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- ─── 2. ListItem and Metadata get a primary key ───────────────────────────
--
-- Both had a unique constraint over exactly the columns that identify a row, and
-- no PRIMARY KEY. Prisma is happy either way — it uses the unique for
-- `findUnique`, and the compound-key argument (`listId_type_imdbId`,
-- `imdbId_type`) is spelled the same for `@@id` as for `@@unique`, so no query
-- changes. Postgres is not: a table with no primary key has no default replica
-- identity, which means logical replication cannot carry its UPDATEs or DELETEs,
-- and several managed-Postgres and change-data-capture tools refuse it outright.
-- Neither is something this app does today; both are things a self-hoster might
-- reasonably do to their own database, and neither should be blocked by an
-- omission with no upside.
--
-- The PRIMARY KEY builds its own unique index over the same columns, so the old
-- one is dropped rather than left as a second copy to maintain on every write.
DROP INDEX "ListItem_listId_type_imdbId_key";
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_pkey" PRIMARY KEY ("listId", "type", "imdbId");

-- Redundant since the day it was written, not just since the line above: the
-- unique index it duplicates also led with "listId", and now the primary key
-- does. A btree on (listId, type, imdbId) answers everything a lookup or an
-- ordering by "listId" alone can ask for.
DROP INDEX "ListItem_listId_idx";

ALTER TABLE "Metadata" DROP CONSTRAINT "Metadata_imdbId_type_key";
ALTER TABLE "Metadata" ADD CONSTRAINT "Metadata_pkey" PRIMARY KEY ("imdbId", "type");

-- ─── 3. Rating's redundant index ──────────────────────────────────────────
--
-- The primary key is (profileId, type, imdbId, season, episode) and leads with
-- profileId, so it already serves every query this index was for. What it cost
-- was a second btree kept up to date on every rating write and rewritten on
-- every profile delete cascade.
DROP INDEX "Rating_profileId_idx";

-- ─── 4. The scrobble cleanup gets an index ────────────────────────────────
--
-- `cleanupStaleSessions` (routes/scrobble.ts) runs hourly and filters on
-- (status, updatedAt) to stop sessions a client abandoned. The one index on the
-- table is (profileId, imdbId, season, episode, status), which leads with
-- profileId and so cannot serve that filter — the job was a sequential scan of
-- the whole table, forever, on a schedule.
--
-- The table is small today because the same job keeps it small, but nothing
-- bounds it: stopped sessions are never deleted, so it grows with every play,
-- and the scan grows with it.
CREATE INDEX "ScrobbleSession_status_updatedAt_idx" ON "ScrobbleSession"("status", "updatedAt");
