-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('movie', 'series', 'episode');

-- CreateEnum
CREATE TYPE "ListKind" AS ENUM ('watchlist', 'custom');

-- CreateEnum
CREATE TYPE "ListItemType" AS ENUM ('movie', 'series');

-- CreateEnum
CREATE TYPE "WatchEventType" AS ENUM ('movie', 'episode');

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "type" "ItemType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "parentImdbId" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "title" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "List" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ListKind" NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListItem" (
    "listId" UUID NOT NULL,
    "type" "ListItemType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WatchEvent" (
    "id" UUID NOT NULL,
    "type" "WatchEventType" NOT NULL,
    "imdbId" TEXT NOT NULL,
    "seriesImdbId" TEXT,
    "season" INTEGER,
    "episode" INTEGER,
    "watchedAt" TIMESTAMPTZ(6) NOT NULL,
    "plays" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesProgress" (
    "seriesImdbId" TEXT NOT NULL,
    "lastSeason" INTEGER NOT NULL,
    "lastEpisode" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SeriesProgress_pkey" PRIMARY KEY ("seriesImdbId")
);

-- CreateTable
CREATE TABLE "KV" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "KV_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Item_imdbId_idx" ON "Item"("imdbId");

-- CreateIndex
CREATE INDEX "ListItem_listId_idx" ON "ListItem"("listId");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_listId_type_imdbId_key" ON "ListItem"("listId", "type", "imdbId");

-- AddForeignKey
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
