-- Stores the authKey for a connected Stremio account, so Cataloggy can read
-- watched state straight from Stremio's library instead of learning about it
-- second-hand through Trakt.
--
-- Single-row by design (id defaults to 'default'), matching "TraktToken": the
-- background poller runs against the oldest profile, the same one every other
-- profile-less surface falls back to.
--
-- No password column, deliberately — the password is exchanged for an authKey
-- at connect time and never persisted.
CREATE TABLE "StremioAuth" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "authKey" TEXT NOT NULL,
    "email" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StremioAuth_pkey" PRIMARY KEY ("id")
);
