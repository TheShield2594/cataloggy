ALTER TYPE "ListKind" ADD VALUE 'collection';

-- Enforce at most one default collection (kind = 'collection') at the database level,
-- mirroring the watchlist singleton constraint above.
CREATE UNIQUE INDEX "List_collection_singleton_key" ON "List"("profileId", "kind") WHERE "kind" = 'collection';
