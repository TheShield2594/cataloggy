-- Adds free-text notes on watch events/ratings (#247), episode-level ratings (#248),
-- and a per-profile tagging system independent of list membership (#250).

ALTER TYPE "MetadataType" ADD VALUE 'episode';

ALTER TABLE "WatchEvent" ADD COLUMN "note" TEXT;

ALTER TABLE "Rating" ADD COLUMN "note" TEXT;
ALTER TABLE "Rating" ADD COLUMN "season" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Rating" ADD COLUMN "episode" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Rating" DROP CONSTRAINT "Rating_pkey";
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_pkey" PRIMARY KEY ("profileId", "type", "imdbId", "season", "episode");

CREATE TABLE "Tag" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
    "name"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT now(),
    "profileId" UUID NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Tag_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Tag_profileId_name_key" ON "Tag"("profileId", "name");
CREATE INDEX "Tag_profileId_idx" ON "Tag"("profileId");

CREATE TABLE "ItemTag" (
    "tagId"     UUID NOT NULL,
    "type"      "ItemType" NOT NULL,
    "imdbId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT now(),

    CONSTRAINT "ItemTag_pkey" PRIMARY KEY ("tagId", "type", "imdbId"),
    CONSTRAINT "ItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ItemTag_type_imdbId_idx" ON "ItemTag"("type", "imdbId");
