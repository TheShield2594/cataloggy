-- The default-watchlist singleton was global, so a household got one watchlist.
--
-- `List_watchlist_singleton_key` (migration 20260617120000) was written a day
-- before profiles existed, and keys on "kind" alone: at most one row in the whole
-- table may be a watchlist. The profiles migration that followed
-- (20260617150000) added `List.profileId` and never revisited it. The collection
-- singleton, added nine days later, got the scoping right —
-- ("profileId", "kind") — which is what this should always have been.
--
-- What it cost: `getDefaultWatchlist(profileId)` finds nothing for a second
-- profile, tries to create, and Postgres rejects it as a duplicate of the first
-- profile's. `findOrCreateTolerant` re-runs the lookup, still finds nothing for
-- this profile, and rethrows — so every route that resolves a watchlist (adding
-- to it, reading it, the Trakt mirror, an import) fails for every profile but
-- the oldest. Only a real database sees this: a mocked Prisma has no partial
-- unique indexes to violate, which is why 39 test files and a green CI run did
-- not.
--
-- No data repair is needed. The old index guaranteed at most one watchlist row
-- existed at all, so nothing on disk can violate the narrower one.
DROP INDEX "List_watchlist_singleton_key";

CREATE UNIQUE INDEX "List_watchlist_singleton_key" ON "List"("profileId", "kind") WHERE "kind" = 'watchlist';
