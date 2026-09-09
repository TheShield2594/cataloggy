import type { FastifyPluginAsync } from "fastify";
import { getSteam } from "../lib/steam-client.js";
import { isSteamSyncConfigured, syncSteamLibrary } from "../lib/steam-sync.js";
import { resolveProfile } from "../lib/profile.js";

// The Steam *account* is env-configured (STEAM_ID), but the library it syncs
// into belongs to whichever profile pressed the button, so the sync route
// resolves the caller's profile. The scheduled sync in index.ts has no request
// to resolve and still falls back to the default profile.
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

  app.post("/games/steam/sync", { preHandler: resolveProfile }, async (request, reply) => {
    // Unconfigured, not broken — the same distinction `/games/search` draws for
    // IGDB. `STEAM_API_KEY`/`STEAM_ID` are optional, so an instance without
    // them is working as installed, and 500 filed that as a server fault every
    // time someone pressed Sync. The 500 below is the real one: a sync that
    // started with credentials and failed.
    //
    // `GET /games/steam/status` already answers this question with a 200 and
    // `configured: false`, because a status endpoint reporting on a disabled
    // integration is doing its job. This route cannot do the work asked of it,
    // so it declines with a code the caller can branch on.
    if (!isSteamSyncConfigured()) {
      return reply.code(503).send({
        error: "Steam sync needs STEAM_API_KEY and STEAM_ID. Set both to enable it.",
        code: "steam_not_configured"
      });
    }

    try {
      const summary = await syncSteamLibrary(request.log, request.profileId!);
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Steam sync failed");
      return reply.code(500).send({ error: "Steam sync failed" });
    }
  });
};

export default gamesSteamRoutes;
