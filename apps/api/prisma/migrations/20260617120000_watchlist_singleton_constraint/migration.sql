-- Collapse any pre-existing duplicate default watchlists, keeping the oldest one,
-- so the partial unique index below can be created.
DELETE FROM "List"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "kind" ORDER BY "createdAt" ASC, "id" ASC) AS rn
    FROM "List"
    WHERE "kind" = 'watchlist'::"ListKind"
  ) ranked
  WHERE rn > 1
);

-- Enforce at most one default watchlist (kind = 'watchlist') at the database level.
-- This is a partial index scoped to the watchlist kind only, so it does not restrict
-- "custom" lists from sharing a name. Prisma's schema DSL cannot express a partial
-- unique index, so this constraint is not mirrored in schema.prisma — do not let a
-- future `prisma migrate dev` drop it as drift.
CREATE UNIQUE INDEX "List_watchlist_singleton_key" ON "List"("kind") WHERE "kind" = 'watchlist';
