-- CreateEnum
CREATE TYPE "MetadataType" AS ENUM ('movie', 'series');

-- CreateTable
CREATE TABLE "Metadata" (
    "imdbId" TEXT NOT NULL,
    "type" "MetadataType" NOT NULL,
    "tmdbId" INTEGER,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "poster" TEXT,
    "background" TEXT,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metadata_imdbId_type_key" UNIQUE ("imdbId", "type")
);
