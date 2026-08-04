import { WatchEventType } from "@prisma/client";
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
import {
  getPendingPlaySignals,
  isPlayDetectionEnabled,
  recordPlaySignal,
  type PlaySignalResource,
} from "../lib/play-signal.js";
import { getDefaultProfileId, resolveProfile } from "../lib/profile.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

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

  // ─── Play signals ───
  //
  // Written only by the addon service, which is the only thing that sees these
  // requests. The profile comes from the addon's own resolution (the installed
  // URL), not from a header, so it is validated here rather than trusted.
  app.post<{ Body: unknown }>("/stremio/play-signal", async (request, reply) => {
    if (!isPlayDetectionEnabled()) return reply.code(202).send({ status: "disabled" });

    const body = request.body as {
      type?: unknown;
      imdbId?: unknown;
      seriesImdbId?: unknown;
      season?: unknown;
      episode?: unknown;
      resource?: unknown;
      profileId?: unknown;
    } | null;

    if (!Object.values(WatchEventType).includes(body?.type as WatchEventType)) {
      return reply.code(400).send({ error: "type must be one of: movie, episode" });
    }
    if (typeof body?.imdbId !== "string" || !body.imdbId.trim()) {
      return reply.code(400).send({ error: "imdbId is required" });
    }
    if (body.resource !== "stream" && body.resource !== "subtitles") {
      return reply.code(400).send({ error: "resource must be one of: stream, subtitles" });
    }

    const profileId =
      typeof body.profileId === "string" && UUID_V4_PATTERN.test(body.profileId)
        ? body.profileId
        : await getDefaultProfileId();

    const result = await recordPlaySignal({
      type: body.type as WatchEventType,
      imdbId: body.imdbId.trim(),
      seriesImdbId: typeof body.seriesImdbId === "string" ? body.seriesImdbId.trim() : null,
      season: typeof body.season === "number" ? body.season : null,
      episode: typeof body.episode === "number" ? body.episode : null,
      resource: body.resource as PlaySignalResource,
      client: request.headers["user-agent"] ?? null,
      profileId,
      log: request.log,
    });

    return reply.code(202).send(result);
  });

  // Diagnostics: what the addon has seen but not yet acted on, so a self-hoster
  // can check what their clients actually send before trusting the inference.
  app.get("/stremio/play-signals", { preHandler: resolveProfile }, async (request) => {
    const signals = await getPendingPlaySignals(request.profileId as string);
    return { enabled: isPlayDetectionEnabled(), signals };
  });
};

export default stremioLibraryRoutes;
