-- Resume points: where a profile stopped part-way through a film or an episode.
--
-- Deliberately a separate table from ScrobbleSession: a session is one play and
-- stopped sessions are never read again, while a resume point is one row per
-- title that outlives the session that wrote it and is cleared once the title is
-- watched. "key" follows PlaySignal's "movie:<imdb>" / "episode:<imdb>:<s>:<e>"
-- form, because a compound unique over nullable season/episode would treat every
-- movie row as distinct.
CREATE TABLE "PlaybackProgress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "type" "WatchEventType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "season" INTEGER,
    "episode" INTEGER,
    "progress" DOUBLE PRECISION NOT NULL,
    "positionSeconds" INTEGER,
    "durationSeconds" INTEGER,
    "pausedAt" TIMESTAMPTZ(6) NOT NULL,
    "profileId" UUID NOT NULL,

    CONSTRAINT "PlaybackProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaybackProgress_profileId_key_key" ON "PlaybackProgress"("profileId", "key");

CREATE INDEX "PlaybackProgress_profileId_pausedAt_idx" ON "PlaybackProgress"("profileId", "pausedAt");

ALTER TABLE "PlaybackProgress" ADD CONSTRAINT "PlaybackProgress_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
