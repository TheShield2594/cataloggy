-- Games section: IGDB metadata/search + a one-way nightly Steam library sync.
-- Deliberately denormalized (see comment on the Game model in schema.prisma) — unlike
-- movies/TV, games have no status system, watch history, or list membership, so identity,
-- artwork, and personal data (rating/notes/finished) all live on one row.

CREATE TABLE "Game" (
    "id"              UUID NOT NULL,
    "igdbId"          INTEGER,
    "steamAppId"      INTEGER,
    "title"           TEXT NOT NULL,
    "coverUrl"        TEXT,
    "releaseDate"     DATE,
    "genres"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "playtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt"    TIMESTAMPTZ(6),
    "rating"          DOUBLE PRECISION,
    "notes"           TEXT,
    "finished"        BOOLEAN NOT NULL DEFAULT false,
    "finishedAt"      DATE,
    "createdAt"       TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(6) NOT NULL,
    "profileId"       UUID NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Game_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Game_igdbId_or_steamAppId_check" CHECK ("igdbId" IS NOT NULL OR "steamAppId" IS NOT NULL)
);

CREATE INDEX "Game_profileId_idx" ON "Game"("profileId");

-- Partial unique indexes: at most one row per profile per external id, but a row is
-- allowed to be missing either id (a manual non-Steam add has no steamAppId; a Steam
-- import that IGDB couldn't confidently match has no igdbId). Not expressible in
-- Prisma's schema DSL, so not declared in schema.prisma — don't let `prisma migrate dev`
-- generate a migration that drops these.
CREATE UNIQUE INDEX "Game_profileId_steamAppId_key" ON "Game"("profileId", "steamAppId") WHERE "steamAppId" IS NOT NULL;
CREATE UNIQUE INDEX "Game_profileId_igdbId_key" ON "Game"("profileId", "igdbId") WHERE "igdbId" IS NOT NULL;
