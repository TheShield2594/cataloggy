-- Holds "the user is about to watch this" signals observed by the Stremio addon
-- (a `stream` or `subtitles` request), until each one either earns promotion to
-- a real WatchEvent or is discarded as browsing.
--
-- Deliberately a separate table from ScrobbleSession: these are inferred, and
-- mixing them in would make /scrobble/now-playing report guesses as live
-- playback. Nothing reads this table as history.
--
-- "key" is an explicit "movie:<imdb>" / "episode:<imdb>:<s>:<e>" string rather
-- than a compound unique over the nullable season/episode columns, because
-- Postgres treats NULLs as distinct — a compound unique would let a movie open
-- an unbounded number of concurrent pending signals.
CREATE TABLE "PlaySignal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "type" "WatchEventType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "season" INTEGER,
    "episode" INTEGER,
    "resource" TEXT NOT NULL,
    "client" TEXT,
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL,
    "dueAt" TIMESTAMPTZ(6) NOT NULL,
    "profileId" UUID NOT NULL,

    CONSTRAINT "PlaySignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlaySignal_profileId_key_key" ON "PlaySignal"("profileId", "key");

CREATE INDEX "PlaySignal_dueAt_idx" ON "PlaySignal"("dueAt");

ALTER TABLE "PlaySignal" ADD CONSTRAINT "PlaySignal_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
