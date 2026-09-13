import { STREAMING_PROVIDERS } from "../tmdb.js";
import type { FastifyPluginAsync } from "fastify";
import {
  getLanguageSetting,
  getRegionSetting,
  getSpoilerProtection,
  setLanguageSetting,
  setRegionSetting,
  setSpoilerProtection,
} from "../lib/settings.js";
import { OMDB_API_KEY_KV, getOmdbApiKey } from "../lib/omdb.js";
import { TMDB_API_KEY_KV, getTmdbApiKey } from "../lib/tmdb-client.js";
import { RPDB_API_KEY_KV, getRpdbApiKey } from "../lib/rpdb.js";
import { trendingCache } from "../lib/cache.js";
import { deleteSecretKv, writeSecretKv } from "../lib/secret-store.js";
import { isServiceRequest } from "../lib/service-request.js";
import { failuresFrom, getJobRuns } from "../lib/job-status.js";
import { outboundFailure } from "../lib/outbound-test.js";
import {
  JellyseerrError,
  clearJellyseerrConfig,
  getJellyseerrConfig,
  publicJellyseerrConfig,
  resolveJellyseerrUrl,
  saveJellyseerrConfig,
  testJellyseerr,
  validateJellyseerrUrl,
  type JellyseerrConfig,
} from "../lib/jellyseerr.js";

const JELLYSEERR_URL_ERROR =
  "url must be an http(s) URL and must not target the cloud-metadata/link-local range";

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/settings/preferences", async () => {
    const [language, region, spoilerProtection] = await Promise.all([
      getLanguageSetting(),
      getRegionSetting(),
      getSpoilerProtection(),
    ]);
    return {
      language,
      region,
      spoilerProtection,
      availableProviders: Object.entries(STREAMING_PROVIDERS).map(([key, val]) => ({ key, ...val })),
    };
  });

  app.post<{ Body: unknown }>("/settings/preferences", async (request, reply) => {
    const body = request.body as {
      language?: unknown;
      region?: unknown;
      spoilerProtection?: unknown;
    } | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
    const REGION_PATTERN = /^[A-Z]{2}$/;

    if (typeof body.language === "string" && body.language.trim()) {
      const [lang = "", region, ...rest] = body.language.trim().split("-");
      // Two parts is `fr-FR`, one is `fr`; anything else fails the pattern
      // below, which is what it did before too.
      const normalizedLang =
        region !== undefined && rest.length === 0
          ? `${lang.toLowerCase()}-${region.toUpperCase()}`
          : lang.toLowerCase();
      if (!LANGUAGE_PATTERN.test(normalizedLang)) {
        return reply.code(400).send({
          error: "language must be a valid language code (e.g., 'en-US', 'fr')",
        });
      }
      await setLanguageSetting(normalizedLang);
    }

    if (typeof body.region === "string" && body.region.trim()) {
      const reg = body.region.trim().toUpperCase();
      if (!REGION_PATTERN.test(reg)) {
        return reply.code(400).send({
          error: "region must be a valid two-letter country code (e.g., 'US', 'GB')",
        });
      }
      await setRegionSetting(reg);
    }

    if (typeof body.spoilerProtection === "boolean") {
      await setSpoilerProtection(body.spoilerProtection);
    }

    trendingCache.clear();

    const [language, region, spoilerProtection] = await Promise.all([
      getLanguageSetting(),
      getRegionSetting(),
      getSpoilerProtection(),
    ]);
    return { language, region, spoilerProtection };
  });

  // ─── TMDB ───

  app.get("/tmdb/status", async () => {
    const { apiKey, source } = await getTmdbApiKey();
    return { configured: !!apiKey, source };
  });

  app.post<{ Body: unknown }>("/tmdb/key", async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | null;
    if (!body || typeof body.apiKey !== "string") {
      return reply.code(400).send({ error: "apiKey must be a string" });
    }

    const apiKey = body.apiKey.trim();
    if (!apiKey) {
      return reply.code(400).send({ error: "apiKey is required" });
    }

    // TMDB is what makes the rest of the app work, so a typo here is worth
    // catching before it is saved over a key that was fine.
    try {
      const testRes = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(apiKey)}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
      );
      if (testRes.status === 401) {
        return reply.code(400).send({ error: "TMDB rejected that API key" });
      }
      if (!testRes.ok) {
        return reply.code(400).send({ error: `TMDB could not validate the key (${testRes.status})` });
      }
    } catch {
      return reply.code(400).send({ error: "Could not reach TMDB to validate key" });
    }

    await writeSecretKv(TMDB_API_KEY_KV, apiKey);
    return { configured: true, source: "db" as const };
  });

  // Removing the saved key falls back to TMDB_API_KEY when the deployment
  // sets one, so the response says what is left rather than assuming nothing.
  app.delete("/tmdb/key", async () => {
    await deleteSecretKv(TMDB_API_KEY_KV);
    const { apiKey, source } = await getTmdbApiKey();
    return { configured: !!apiKey, source };
  });

  // ─── OMDB ───

  app.get("/omdb/status", async () => {
    const apiKey = await getOmdbApiKey();
    return { configured: !!apiKey };
  });

  app.post<{ Body: unknown }>("/omdb/key", async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | null;
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) {
      await deleteSecretKv(OMDB_API_KEY_KV);
      return { configured: false };
    }

    try {
      const testUrl = `https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(apiKey)}`;
      const testRes = await fetch(testUrl, { signal: AbortSignal.timeout(8000) });
      const testData = await testRes.json() as { Response?: string; Error?: string };
      if (testData.Response === "False") {
        return reply.code(400).send({ error: testData.Error ?? "Invalid OMDB API key" });
      }
    } catch {
      return reply.code(400).send({ error: "Could not reach OMDB API to validate key" });
    }

    await writeSecretKv(OMDB_API_KEY_KV, apiKey);
    return { configured: true };
  });

  app.delete("/omdb/key", async () => {
    await deleteSecretKv(OMDB_API_KEY_KV);
    return { configured: false };
  });

  // ─── RPDB ───

  app.get("/rpdb/status", async () => {
    const apiKey = await getRpdbApiKey();
    return { configured: !!apiKey, hasKey: !!apiKey };
  });

  app.post<{ Body: unknown }>("/rpdb/key", async (request, reply) => {
    const body = request.body as { apiKey?: unknown } | null;
    if (!body || typeof body.apiKey !== "string") {
      return reply.code(400).send({ error: "apiKey must be a string" });
    }

    const apiKey = body.apiKey.trim();
    if (!apiKey) {
      await deleteSecretKv(RPDB_API_KEY_KV);
      return { configured: false };
    }

    await writeSecretKv(RPDB_API_KEY_KV, apiKey);
    return { configured: true };
  });

  app.delete("/rpdb/key", async () => {
    await deleteSecretKv(RPDB_API_KEY_KV);
    return { configured: false };
  });

  // No per-title poster endpoint: RPDB posters reach a client without one. The
  // API swaps them in server-side (`withRpdbPoster` / `applyRpdbToMetaList`),
  // and the add-on reads the key once from `/rpdb/config` and builds its own
  // URLs — which is what this route is for.
  //
  // It is the one place a stored third-party key is handed back out, so it is
  // restricted to the add-on service rather than to `API_TOKEN`: the browser
  // holds that token too, and has no use for the key. `/rpdb/status` is what
  // Settings reads, and says only whether one is configured.
  //
  // 404 rather than 401 — to anything that isn't the add-on, this route does
  // not exist.
  app.get("/rpdb/config", async (request, reply) => {
    if (!isServiceRequest(request)) return reply.code(404).send({ error: "Not found" });
    const apiKey = await getRpdbApiKey();
    return { enabled: !!apiKey, apiKey: apiKey ?? null };
  });

  // ─── Jellyseerr / Overseerr ───
  // The one outbound integration: a watchlist add can become a request on the
  // server that actually fetches things. See lib/jellyseerr.ts.

  app.get("/settings/jellyseerr", async () => {
    const config = await getJellyseerrConfig();
    return { configured: !!config, config: config ? publicJellyseerrConfig(config) : null };
  });

  app.post<{ Body: unknown }>("/settings/jellyseerr", async (request, reply) => {
    const body = request.body as {
      url?: unknown;
      apiKey?: unknown;
      requestOnAdd?: unknown;
      cancelOnRemove?: unknown;
    } | null;
    if (!body) return reply.code(400).send({ error: "Body is required" });

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url || !validateJellyseerrUrl(url)) {
      return reply.code(400).send({ error: JELLYSEERR_URL_ERROR });
    }

    // The literal hostname is only half the check — a public name pointing at
    // the metadata service passes the syntax test and fails this one.
    if (!(await resolveJellyseerrUrl(url))) {
      return reply.code(400).send({ error: "url resolves to an address that is not an allowed outbound target" });
    }

    // An existing key is kept when the field is left blank, so toggling
    // "request on add" doesn't mean re-typing a credential the server already
    // holds and never hands back.
    const existing = await getJellyseerrConfig();
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : existing?.apiKey ?? "";
    if (!apiKey) return reply.code(400).send({ error: "apiKey is required" });

    const config: JellyseerrConfig = {
      url,
      apiKey,
      requestOnAdd: typeof body.requestOnAdd === "boolean" ? body.requestOnAdd : existing?.requestOnAdd ?? true,
      cancelOnRemove: typeof body.cancelOnRemove === "boolean" ? body.cancelOnRemove : existing?.cancelOnRemove ?? false,
    };

    // Stored, not sent to. Proving the connection is `/settings/jellyseerr/test`
    // below, which Settings calls the moment a save lands — the same shape the
    // notification channels have, for two reasons beyond consistency:
    //
    //   * A server that is off must not stop you saving a correct URL. Testing
    //     inline meant a Jellyseerr that was down for the evening refused every
    //     save, including the one fixing a typo.
    //   * Fetching a URL that arrived in this request body is the request-forgery
    //     shape a scanner is right to flag. What the test route reaches for is
    //     what is stored — validated above, and validated again per request in
    //     `lib/jellyseerr.ts`.
    await saveJellyseerrConfig(config);
    return { configured: true, config: publicJellyseerrConfig(config) };
  });

  app.delete("/settings/jellyseerr", async () => {
    await clearJellyseerrConfig();
    return { configured: false, config: null };
  });

  // Same argument as the notification-channel test: the failures people hit
  // here are a moved container, a revoked key or a URL that never reached the
  // right service, and none of those are visible from the stored config.
  app.post("/settings/jellyseerr/test", async (request, reply) => {
    const config = await getJellyseerrConfig();
    if (!config) return reply.code(404).send({ error: "Jellyseerr is not configured" });

    try {
      const result = await testJellyseerr(config);
      return { success: true as const, ...result };
    } catch (error) {
      // The status code and the socket error stay in the log, for the reason
      // lib/outbound-test.ts gives.
      request.log.warn({ err: error }, "Jellyseerr connection test failed");
      return error instanceof JellyseerrError
        ? outboundFailure(error.outcome, error.publicMessage)
        : outboundFailure("failed");
    }
  });

  // ─── Background job status ───
  // Surfaces scheduled-job failures (Steam sync, Trakt poll, episode
  // notifications, AI recs) that would otherwise only be visible in server
  // logs or Sentry (opt-in, off by default) — see lib/job-status.ts.
  //
  // `runs` carries the last run of every job, failed or not, with how long it
  // took: a job that outlasts its own interval has its next tick dropped by the
  // scheduler, which is invisible from a list of failures because nothing
  // failed.
  app.get("/settings/job-status", async () => {
    const runs = await getJobRuns();
    return { failures: failuresFrom(runs), runs };
  });
};

export default settingsRoutes;
