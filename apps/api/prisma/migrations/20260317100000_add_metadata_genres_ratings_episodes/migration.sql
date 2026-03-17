-- AlterTable
ALTER TABLE "Metadata" ADD COLUMN "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "rating" DOUBLE PRECISION,
ADD COLUMN "voteCount" INTEGER,
ADD COLUMN "totalSeasons" INTEGER,
ADD COLUMN "totalEpisodes" INTEGER;

-- Backfill: After running this migration, hydrate the new columns for existing rows
-- by calling POST /metadata/refresh-all (or the "Sync all metadata" button in Settings).
-- The refresh fetches detailed TMDB data (genres, rating, voteCount, totalSeasons,
-- totalEpisodes) for every tracked item. It is idempotent and can be resumed/re-run
-- safely. For large libraries, consider throttling via TMDB_RATE_LIMIT_MS env var
-- to avoid upstream rate limits.
