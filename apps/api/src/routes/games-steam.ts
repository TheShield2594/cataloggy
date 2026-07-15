import type { FastifyPluginAsync } from "fastify";
import { getSteam } from "../lib/steam-client.js";
import { isSteamSyncConfigured, syncSteamLibrary } from "../lib/steam-sync.js";
import { getDefaultProfileId } from "../lib/profile.js";

// Steam sync targets a single, env-configured account (STEAM_ID), not the
// caller's profile, so these routes intentionally skip resolveProfile —
// same reasoning as /trakt/poll in routes/trakt.ts.
const gamesSteamRoutes: FastifyPluginAsync = async (app) => {
  app.get("/games/steam/status", async (_request, reply) => {
    const configured = isSteamSyncConfigured();
    if (!configured) {
      return reply.send({ configured: false, player: null });
    }

    const steamId = process.env.STEAM_ID!.trim();
    let player: Awaited<ReturnType<ReturnType<typeof getSteam>["getPlayerSummary"]>> = null;
    try {
      player = await getSteam().getPlayerSummary(steamId);
    } catch (error) {
      // Best-effort only: the sync itself doesn't need the player summary,
      // this is purely a "connected as X" status display.
      app.log.warn(error, "Steam player summary lookup failed");
    }

    return reply.send({ configured: true, player });
  });

  app.post("/games/steam/sync", async (request, reply) => {
    if (!isSteamSyncConfigured()) {
      return reply.code(500).send({ error: "Steam integration is not configured" });
    }

    try {
      const profileId = await getDefaultProfileId();
      const summary = await syncSteamLibrary(request.log, profileId);
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Steam sync failed");
      return reply.code(500).send({ error: "Steam sync failed" });
    }
  });
};

export default gamesSteamRoutes;
