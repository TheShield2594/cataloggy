-- Enforce at most one default collection (kind = 'collection') at the database level,
-- mirroring the watchlist singleton constraint above. Split into a follow-up migration
-- from 20260626130000_add_collection_enum_value because the new enum value must be
-- committed before it can be referenced.
CREATE UNIQUE INDEX "List_collection_singleton_key" ON "List"("profileId", "kind") WHERE "kind" = 'collection';
