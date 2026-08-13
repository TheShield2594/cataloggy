-- The addon service used to advertise every one of a profile's lists as a
-- Stremio catalog, ignoring the enabled-catalog config entirely — so the
-- Settings picker's list checkboxes did nothing, and unticking a list left it
-- in Stremio. It now honours the config, like the API's manifest always has.
--
-- That makes the config authoritative, and a config written before this change
-- names no lists at all: without this migration, every existing install would
-- silently lose its custom-list catalogs on upgrade. So each profile's config
-- gains a "list:<id>" entry for the custom lists it has today, which is exactly
-- what the addon was already showing. Lists created afterwards are opt-in via
-- Settings, matching what the picker has always claimed.
--
-- Only custom lists are involved: the watchlist and the collection are core
-- catalogs with no checkbox in the picker, and both manifests keep serving them
-- unconditionally.
INSERT INTO "KV" ("key", "value", "updatedAt")
SELECT
  'addon:config:' || merged.profile_id::text,
  jsonb_build_object('enabledCatalogs', merged.enabled)::text,
  NOW()
FROM (
  SELECT
    existing.profile_id,
    (SELECT jsonb_agg(DISTINCT entry) FROM jsonb_array_elements(existing.current || existing.lists) AS entry) AS enabled
  FROM (
    SELECT
      p."id" AS profile_id,
      -- A row that is missing, unparseable or not an array starts from the same
      -- defaults `getAddonConfig` falls back to, so the merge never turns a
      -- default config into an empty one.
      COALESCE(
        -- Nested rather than one AND: only the selected CASE branch is
        -- evaluated, so the cast never runs on a row that isn't JSON.
        CASE WHEN kv."value" IS JSON OBJECT THEN
          CASE
            WHEN jsonb_typeof(kv."value"::jsonb -> 'enabledCatalogs') = 'array'
              THEN kv."value"::jsonb -> 'enabledCatalogs'
          END
        END,
        '["cataloggy-trending-movie","cataloggy-trending-series","cataloggy-popular-movie","cataloggy-popular-series","cataloggy-recommended-movie","cataloggy-recommended-series"]'::jsonb
      ) AS current,
      COALESCE(
        jsonb_agg(to_jsonb('list:' || l."id"::text)) FILTER (WHERE l."id" IS NOT NULL),
        '[]'::jsonb
      ) AS lists
    FROM "Profile" p
    LEFT JOIN "List" l ON l."profileId" = p."id" AND l."kind" = 'custom'
    LEFT JOIN "KV" kv ON kv."key" = 'addon:config:' || p."id"::text
    GROUP BY p."id", kv."value"
  ) AS existing
  WHERE jsonb_array_length(existing.lists) > 0
) AS merged
ON CONFLICT ("key") DO UPDATE
  SET "value" = EXCLUDED."value", "updatedAt" = NOW();
