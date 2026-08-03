-- The Stremio addon's enabled-catalog set lived in a single KV row keyed
-- "addon:config", shared by every profile: enabling a catalog in one profile
-- enabled it for all of them. It is now keyed per profile as
-- "addon:config:<profileId>".
--
-- Copy the existing row onto the oldest profile — the one every profile-less
-- surface (the Stremio addon protocol, background jobs) already falls back to —
-- so an existing install keeps the catalogs it had selected. Other profiles get
-- no row and therefore start from the default catalog set.
--
-- The legacy row is copied, not moved: nothing reads it any more, and leaving it
-- means rolling an image back restores the previous behaviour rather than
-- silently resetting the addon to the defaults.
INSERT INTO "KV" ("key", "value", "updatedAt")
SELECT 'addon:config:' || p."id"::text, legacy."value", NOW()
FROM "KV" legacy
CROSS JOIN (SELECT "id" FROM "Profile" ORDER BY "createdAt" ASC LIMIT 1) AS p
WHERE legacy."key" = 'addon:config'
ON CONFLICT ("key") DO NOTHING;
