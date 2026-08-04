import type { FastifyPluginAsync } from "fastify";
import {
  connectStremio,
  disconnectStremio,
  getStremioStatus,
  isStremioConnected,
  resetStremioClient,
  syncStremioLibrary,
  StremioApiError,
} from "../lib/stremio-library.js";
import { getDefaultProfileId } from "../lib/profile.js";

// The connect route takes a password. Rate-limited like the other
// credential-accepting routes (PIN verification, the Trakt OAuth pair) so this
// can't be used to grind against Stremio's login endpoint from behind the API
// token — and so a mistyped password doesn't retry in a loop.
const CONNECT_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

const stremioLibraryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stremio/library/status", async (_request, reply) => {
    return reply.send(await getStremioStatus());
  });

  app.post<{ Body: unknown }>("/stremio/library/connect", CONNECT_RATE_LIMIT, async (request, reply) => {
    const body = request.body as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    try {
      await connectStremio(email, password, request.log);
    } catch (error) {
      if (error instanceof StremioApiError) {
        // Stremio's own wording is the useful part here ("Wrong password",
        // "User not found"); it says nothing the caller didn't already supply.
        return reply.code(401).send({ error: error.message });
      }
      request.log.error(error, "Stremio connect failed");
      return reply.code(502).send({ error: "Could not reach Stremio" });
    }

    // Learn the current library state without recording it, so connecting an
    // account with years of history doesn't backdate a flood of watch events
    // the user never asked for. `POST /stremio/library/import` is the opt-in.
    try {
      const profileId = await getDefaultProfileId();
      await syncStremioLibrary(request.log, profileId, "baseline");
    } catch (error) {
      request.log.warn(error, "Stremio baseline sync failed after connecting");
    }

    return reply.code(200).send(await getStremioStatus());
  });

  app.post("/stremio/library/disconnect", async (_request, reply) => {
    await disconnectStremio();
    resetStremioClient();
    return reply.code(200).send({ connected: false });
  });

  // One-time backfill of everything the Stremio account already has marked as
  // watched, dated from Stremio's own `lastWatched` rather than from now.
  app.post("/stremio/library/import", async (request, reply) => {
    if (!(await isStremioConnected())) {
      return reply.code(400).send({ error: "No Stremio account is connected" });
    }
    try {
      const profileId = await getDefaultProfileId();
      const summary = await syncStremioLibrary(request.log, profileId, "import");
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Stremio library import failed");
      return reply.code(502).send({ error: "Stremio library import failed" });
    }
  });

  // Manual trigger for the same pass the scheduler runs.
  app.post("/stremio/library/sync", async (request, reply) => {
    if (!(await isStremioConnected())) {
      return reply.code(400).send({ error: "No Stremio account is connected" });
    }
    try {
      const profileId = await getDefaultProfileId();
      const summary = await syncStremioLibrary(request.log, profileId, "incremental");
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Stremio library sync failed");
      return reply.code(502).send({ error: "Stremio library sync failed" });
    }
  });
};

export default stremioLibraryRoutes;
