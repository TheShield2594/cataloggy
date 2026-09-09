import { IgdbClient } from "../igdb.js";

/**
 * Whether IGDB has credentials to work with — the same pair `fromEnv()`
 * requires, checked without constructing a client.
 *
 * Callers need this separately from `getIgdb()` because the two failures it
 * separates are different kinds of thing. Games is optional, so an instance
 * that never set `TWITCH_CLIENT_ID` is working as installed and the API should
 * say so; a `fromEnv()` that throws with both variables present is a fault.
 * Inferring the first from a thrown error collapses both into one catch block,
 * which is how the unconfigured case came to be reported as a 500.
 *
 * Mirrors `isSteamSyncConfigured()` in `steam-sync.ts`.
 */
export const isIgdbConfigured = (): boolean =>
  !!process.env.TWITCH_CLIENT_ID?.trim() && !!process.env.TWITCH_CLIENT_SECRET?.trim();

export const getIgdb = (): IgdbClient => IgdbClient.fromEnv();
