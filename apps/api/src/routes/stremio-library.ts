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
import { getDefaultProfileId, PROFILE_HEADER, resolveProfile } from "../lib/profile.js";
import { isServiceRequest } from "../lib/service-request.js";
import { UUID_V4_PATTERN } from "../lib/types.js";

// The connect route takes a password. Rate-limited like the other
// credential-accepting routes (PIN verification, the Trakt OAuth pair) so this
// can't be used to grind against Stremio's login endpoint from behind the API
// token — and so a mistyped password doesn't retry in a loop.
const CONNECT_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

// Client identifiers are attacker-controlled strings kept only for display.
const MAX_CLIENT_LENGTH = 200;

const stremioLibraryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stremio/library/status", async (_request, reply) => {
    return reply.send(await getStremioStatus());
  });

  // Every route below acts on a profile's library, so it takes the profile from
  // the request rather than assuming the default one — an import run while
  // acting as a second profile belongs to that profile. Only the scheduled job,
  // which has no request to resolve, falls back to `getDefaultProfileId`.
  app.post<{ Body: unknown }>(
    "/stremio/library/connect",
    { ...CONNECT_RATE_LIMIT, preHandler: resolveProfile },
    async (request, reply) => {
      const body = request.body as { email?: unknown; password?: unknown } | null;
      const email = typeof body?.email === "string" ? body.email.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";

      if (!email || !password) {
        return reply.code(400).send({ error: "email and password are required" });
      }

      try {
        await connectStremio(email, password, request.profileId as string, request.log);
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
      //
      // A connection whose baseline never landed is not a usable connection: the
      // scheduler's next incremental pass would read an empty watermark, find the
      // entire library "new", and record all of it as watched — the exact flood
      // the baseline exists to prevent. So a failure here undoes the connection
      // rather than leaving it in place to do that.
      try {
        await syncStremioLibrary(request.log, request.profileId as string, "baseline");
      } catch (error) {
        request.log.error(error, "Stremio baseline sync failed after connecting — undoing the connection");
        await disconnectStremio();
        resetStremioClient();
        return reply
          .code(502)
          .send({ error: "Connected to Stremio, but could not read the library. Nothing was saved." });
      }

      return reply.code(200).send(await getStremioStatus());
    }
  );

  app.post("/stremio/library/disconnect", async (_request, reply) => {
    await disconnectStremio();
    resetStremioClient();
    return reply.code(200).send({ connected: false });
  });

  // One-time backfill of everything the Stremio account already has marked as
  // watched, dated from Stremio's own `lastWatched` rather than from now.
  app.post("/stremio/library/import", { preHandler: resolveProfile }, async (request, reply) => {
    if (!(await isStremioConnected())) {
      return reply.code(400).send({ error: "No Stremio account is connected" });
    }
    try {
      const summary = await syncStremioLibrary(request.log, request.profileId as string, "import");
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Stremio library import failed");
      return reply.code(502).send({ error: "Stremio library import failed" });
    }
  });

  // Manual trigger for the same pass the scheduler runs.
  app.post("/stremio/library/sync", { preHandler: resolveProfile }, async (request, reply) => {
    if (!(await isStremioConnected())) {
      return reply.code(400).send({ error: "No Stremio account is connected" });
    }
    try {
      const summary = await syncStremioLibrary(request.log, request.profileId as string, "incremental");
      return reply.code(200).send(summary);
    } catch (error) {
      request.log.error(error, "Stremio library sync failed");
      return reply.code(502).send({ error: "Stremio library sync failed" });
    }
  });

  // ─── Play signals ───
  //
  // Written only by the addon service, which is the only thing that sees these
  // requests. The profile is the addon's own resolution of the installed URL
  // (`/p/<uuid>/…`), so it is validated here rather than trusted.
  //
  // It may arrive either way round. The addon sends it as `x-profile-id`, the
  // header it puts on every other call it makes; the body field is the shape
  // this route was written to and is what an addon old enough to send it uses.
  // Reading only the body meant a signal from a profile-scoped install was
  // recorded against the *default* profile, so on a household install one
  // person's viewing landed in another's history.
  //
  // Whichever way it arrives, it names the profile written to and nothing here
  // goes through `resolveProfile` — so holding `API_TOKEN` was otherwise enough
  // to write into a PIN-protected profile just by naming its UUID, and
  // `settleDuePlaySignals` later turns those signals into watch events. The
  // add-on's derived service token is what separates the add-on from every
  // other holder of the shared token, so it is the gate; 404, because to
  // anything else this route does not exist.
  app.post<{ Body: unknown }>("/stremio/play-signal", async (request, reply) => {
    if (!isServiceRequest(request)) return reply.code(404).send({ error: "Not found" });
    if (!isPlayDetectionEnabled()) return reply.code(202).send({ status: "disabled" });

    const body = request.body as {
      type?: unknown;
      imdbId?: unknown;
      seriesImdbId?: unknown;
      season?: unknown;
      episode?: unknown;
      resource?: unknown;
      profileId?: unknown;
      client?: unknown;
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

    const headerValue = request.headers[PROFILE_HEADER];
    const headerProfileId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const reported = [body.profileId, headerProfileId].find(
      (candidate): candidate is string => typeof candidate === "string" && UUID_V4_PATTERN.test(candidate)
    );
    const profileId = reported ?? (await getDefaultProfileId());

    const result = await recordPlaySignal({
      type: body.type as WatchEventType,
      imdbId: body.imdbId.trim(),
      seriesImdbId: typeof body.seriesImdbId === "string" ? body.seriesImdbId.trim() : null,
      season: typeof body.season === "number" ? body.season : null,
      episode: typeof body.episode === "number" ? body.episode : null,
      resource: body.resource as PlaySignalResource,
      // The addon forwards the *player's* user-agent. This request's own header
      // is the addon service's fetch agent, which identifies nothing useful —
      // it is only a fallback for an addon too old to send the field.
      client:
        typeof body.client === "string" && body.client.trim()
          ? body.client.trim().slice(0, MAX_CLIENT_LENGTH)
          : (request.headers["user-agent"] ?? null),
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
