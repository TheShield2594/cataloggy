-- CreateTable
CREATE TABLE "ScrobbleSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "WatchEventType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "seriesImdbId" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'playing',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ScrobbleSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrobbleSession_status_idx" ON "ScrobbleSession"("status");

-- CreateIndex
CREATE INDEX "ScrobbleSession_imdbId_idx" ON "ScrobbleSession"("imdbId");
