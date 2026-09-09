import type { FastifyPluginAsync } from "fastify";
import { isIgdbConfigured } from "../lib/igdb-client.js";

// The IGDB counterpart to `games-steam.ts`'s status route, and its own file for
// the same reason that one is: this answers a question about the *server's*
// configuration, so it takes no profile, while everything in `games.ts` is
// scoped to one via a plugin-wide `preHandler`.
//
// It exists because `GET /games` cannot answer it. The library list is a plain
// database read, so an empty shelf comes back as a 200 and an empty array
// whether the instance has no games or was never given credentials to find any
// — which is how the Games page came to show "No games in your library yet" for
// both. Searching is the only thing that needs IGDB, and by then the user has
// already opened the add dialog.
const gamesIgdbRoutes: FastifyPluginAsync = async (app) => {
  app.get("/games/igdb/status", async (_request, reply) => {
    return reply.send({ configured: isIgdbConfigured() });
  });
};

export default gamesIgdbRoutes;
