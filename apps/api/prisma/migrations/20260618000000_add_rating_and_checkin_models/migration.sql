-- Ratings and the active check-in were previously stored as JSON blobs in
-- the generic KV table (keyed by "rating:<type>:<imdbId>" and
-- "checkin:active:<profileId>"). This gives them proper, indexed,
-- foreign-key-constrained tables instead.

CREATE TABLE "Rating" (
    "imdbId"    TEXT NOT NULL,
    "type"      "MetadataType" NOT NULL,
    "rating"    DOUBLE PRECISION NOT NULL,
    "ratedAt"   TIMESTAMPTZ(6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "profileId" UUID NOT NULL,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("profileId", "type", "imdbId"),
    CONSTRAINT "Rating_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Rating_profileId_idx" ON "Rating"("profileId");

CREATE TABLE "CheckIn" (
    "type"         "WatchEventType" NOT NULL,
    "imdbId"       TEXT NOT NULL,
    "seriesImdbId" TEXT,
    "season"       INTEGER,
    "episode"      INTEGER,
    "name"         TEXT NOT NULL,
    "poster"       TEXT,
    "startedAt"    TIMESTAMPTZ(6) NOT NULL,
    "expiresAt"    TIMESTAMPTZ(6),
    "profileId"    UUID NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("profileId"),
    CONSTRAINT "CheckIn_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Backfill from KV ───
-- Ratings were global (no profile concept), so they're attributed to the
-- oldest profile, matching how other pre-profile data was backfilled in
-- the 20260617150000_add_profiles migration.

INSERT INTO "Rating" ("imdbId", "type", "rating", "ratedAt", "updatedAt", "profileId")
SELECT
    substring(kv.key from length('rating:' || split_part(kv.key, ':', 2) || ':') + 1) AS "imdbId",
    split_part(kv.key, ':', 2)::"MetadataType" AS "type",
    (kv.value::jsonb ->> 'rating')::DOUBLE PRECISION AS "rating",
    (kv.value::jsonb ->> 'ratedAt')::TIMESTAMPTZ AS "ratedAt",
    kv."updatedAt"::TIMESTAMPTZ AS "updatedAt",
    p.id AS "profileId"
FROM "KV" kv
CROSS JOIN (SELECT id FROM "Profile" ORDER BY "createdAt" ASC LIMIT 1) p
WHERE kv.key LIKE 'rating:%'
ON CONFLICT DO NOTHING;

INSERT INTO "CheckIn" ("type", "imdbId", "seriesImdbId", "season", "episode", "name", "poster", "startedAt", "expiresAt", "profileId")
SELECT
    (kv.value::jsonb ->> 'type')::"WatchEventType" AS "type",
    kv.value::jsonb ->> 'imdbId' AS "imdbId",
    kv.value::jsonb ->> 'seriesImdbId' AS "seriesImdbId",
    (kv.value::jsonb ->> 'season')::INTEGER AS "season",
    (kv.value::jsonb ->> 'episode')::INTEGER AS "episode",
    kv.value::jsonb ->> 'name' AS "name",
    kv.value::jsonb ->> 'poster' AS "poster",
    (kv.value::jsonb ->> 'startedAt')::TIMESTAMPTZ AS "startedAt",
    (kv.value::jsonb ->> 'expiresAt')::TIMESTAMPTZ AS "expiresAt",
    substring(kv.key from length('checkin:active:') + 1)::UUID AS "profileId"
FROM "KV" kv
WHERE kv.key LIKE 'checkin:active:%'
  AND EXISTS (
    SELECT 1 FROM "Profile" p
    WHERE p.id = substring(kv.key from length('checkin:active:') + 1)::UUID
  )
ON CONFLICT DO NOTHING;

DELETE FROM "KV" WHERE key LIKE 'rating:%' OR key LIKE 'checkin:active:%';
