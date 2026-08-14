-- Make WatchEvent's dedup rule an invariant of the schema rather than a convention
-- of the code. Every path that records a watch used to read for an existing row and
-- then create one, so two concurrent writers both saw "nothing there" and both
-- created: a Plex and a Jellyfin webhook for the same play, two scrobble clients on
-- one title, the add-on's mark-watched landing next to a webhook, a manual "Sync now"
-- overlapping the scheduled Trakt poll.
--
-- The key is the one `recordWatchEvent` has always used — a profile's watch of one
-- title on one UTC day — expressed so Postgres can enforce it:
--
--   * COALESCE("seriesImdbId", "imdbId") — episodes key on the series, movies on the
--     film. Both write `imdbId`, and episodes mirror the series id into it, so the
--     COALESCE agrees with every write path.
--   * COALESCE("season", -1) / COALESCE("episode", -1) — movies leave both NULL, and
--     Postgres treats NULLs in a unique index as distinct from one another, so the
--     raw columns would enforce nothing at all for films. Season and episode numbers
--     are never negative, so -1 is a stand-in no real row can collide with. (The
--     alternative, NULLS NOT DISTINCT, is available on the pinned postgres:16 but
--     would tie this migration to that floor for no gain.)
--   * ("watchedAt" AT TIME ZONE 'UTC')::date — the day window. `recordWatchEvent`
--     folds a same-day rewatch into `plays` and moves `watchedAt` within the day, so
--     a constraint on the exact timestamp would not express the rule the code
--     already follows and would still admit two same-day rows.
--
-- The index is partial on "traktHistoryId" IS NULL. Rows imported from Trakt's
-- history carry that id and already have a uniqueness guarantee of their own
-- (WatchEvent.traktHistoryId is unique), which is what makes re-polling an
-- overlapping window idempotent. One Trakt history entry is one play, so two entries
-- for the same episode on the same day are two real rows; folding them into the day
-- bucket would either lose a play on import or double-count it on the next poll,
-- because there is nowhere to record the second entry's id. Excluding them leaves
-- Trakt import behaving exactly as it does today while every other writer — which is
-- every writer named above — gets the constraint.

-- Merge duplicates that this bug has already written, or the CREATE UNIQUE INDEX
-- below fails and docker-compose's `api` service, which waits on `migrate` exiting
-- 0, never starts.
--
-- The survivor is the earliest row in each group, except that a row with a known
-- date is preferred over one flagged `dateUnknown` — a real date is information the
-- group would otherwise lose. Its `plays` becomes the group's total and it takes the
-- earliest note in the group if it has none of its own. `traktHistoryId` needs no
-- merging: it is NULL for every row this touches.
UPDATE "WatchEvent" w
SET "plays" = m.total_plays,
    "note"  = COALESCE(w."note", m.merged_note)
FROM (
  SELECT
    (ARRAY_AGG("id" ORDER BY "dateUnknown" ASC, "watchedAt" ASC, "id" ASC))[1] AS keep_id,
    SUM("plays")::int AS total_plays,
    (ARRAY_REMOVE(ARRAY_AGG("note" ORDER BY "dateUnknown" ASC, "watchedAt" ASC, "id" ASC), NULL))[1] AS merged_note
  FROM "WatchEvent"
  WHERE "traktHistoryId" IS NULL
  GROUP BY
    "profileId",
    "type",
    COALESCE("seriesImdbId", "imdbId"),
    COALESCE("season", -1),
    COALESCE("episode", -1),
    (("watchedAt" AT TIME ZONE 'UTC')::date)
  HAVING COUNT(*) > 1
) m
WHERE w."id" = m.keep_id;

DELETE FROM "WatchEvent"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY
          "profileId",
          "type",
          COALESCE("seriesImdbId", "imdbId"),
          COALESCE("season", -1),
          COALESCE("episode", -1),
          (("watchedAt" AT TIME ZONE 'UTC')::date)
        ORDER BY "dateUnknown" ASC, "watchedAt" ASC, "id" ASC
      ) AS rn
    FROM "WatchEvent"
    WHERE "traktHistoryId" IS NULL
  ) ranked
  WHERE ranked.rn > 1
);

-- Not CONCURRENTLY: this file has more than one statement, so Prisma's migration
-- runner hands it to Postgres as an implicit transaction block, where CONCURRENTLY
-- is rejected. Holding the lock is also what makes the dedup above safe — a write
-- landing between the DELETE and the index would fail the migration.
CREATE UNIQUE INDEX "watchevent_dedup_key" ON "WatchEvent" (
  "profileId",
  "type",
  COALESCE("seriesImdbId", "imdbId"),
  COALESCE("season", -1),
  COALESCE("episode", -1),
  (("watchedAt" AT TIME ZONE 'UTC')::date)
) WHERE "traktHistoryId" IS NULL;
