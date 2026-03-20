-- AlterTable
ALTER TABLE "Metadata" ADD COLUMN "runtime"       INTEGER,
                        ADD COLUMN "certification" TEXT,
                        ADD COLUMN "status"        TEXT,
                        ADD COLUMN "network"       TEXT,
                        ADD COLUMN "releaseDate"   TEXT;
