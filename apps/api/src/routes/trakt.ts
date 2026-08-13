import { ItemType, ListItemType, MetadataType, Prisma } from "@prisma/client";
import type { FastifyPluginAsync, RouteHandlerMethod } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getTmdb } from "../lib/tmdb-client.js";
import { upsertMetadata } from "../lib/metadata.js";
import { upsertSeriesProgressIfNewer } from "../lib/series-progress.js";
import { getDefaultWatchlist } from "../lib/watchlist.js";
import {
  getTraktClient,
  resetTraktClient,
  pollTraktHistory,
  syncTraktWatchlist,
  computeTokenExpiresAt,
} from "../lib/trakt-client.js";
import {
  importTraktCollection,
  importTraktPersonalLists,
  importTraktRatings,
} from "../lib/trakt-import.js";
import { renderOAuthHtml } from "../lib/html.js";
import { SECRET_CONTEXT, encryptSecret } from "../lib/secret-box.js";
import { consumeOAuthState, createOAuthState } from "../lib/trakt-oauth-state.js";
import { getDefaultProfileId, resolveProfile } from "../lib/profile.js";
import type { SeriesProgressCandidate } from "../lib/types.js";

// Tighter than the global 200/min bucket, on the two routes that touch the
// OAuth state table: the callback is unauthenticated by construction (trakt.tv
// redirects a browser to it) and deletes a row per request, and each authorize
// call writes one — so this also bounds how many pending states a single client
// can pile up. Matches the limit PIN verification already uses; completing the
// linking flow takes one request, not ten.
const OAUTH_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

// A full import walks the entire account and can run for minutes. Two at once
// do the same work twice against the same rows — every write is idempotent, so
// the result is correct either way, but the second run only adds contention and
// Trakt requests. A second click gets told to wait instead.
let importInProgress = false;

/**
 * Refuses a second import while one is running, and releases the flag however
 * the first ends — a failed import must not lock the route until restart.
 */
const withImportLock =
  (handler: RouteHandlerMethod): RouteHandlerMethod =>
  async function (request, reply) {
    if (importInProgress) {
      return reply.code(409).send({ error: "A Trakt import is already running. Wait for it to finish." });
    }
    importInProgress = true;
    try {
      return await handler.call(this, request, reply);
    } finally {
      importInProgress = false;
    }
  };

const traktRoutes: FastifyPluginAsync = async (app) => {
  app.get("/trakt/status", async (_request, reply) => {
    const token = await prisma.traktToken.findUnique({ where: { id: "default" } });
    const configured = !!(process.env.TRAKT_CLIENT_ID && process.env.TRAKT_CLIENT_SECRET);
    const redirectUri =
      process.env.TRAKT_REDIRECT_URI ??
      `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
    return reply.send({
      connected: !!token,
      configured,
      expiresAt: token?.expiresAt ?? null,
      redirectUri,
    });
  });

  app.get("/trakt/oauth/authorize", OAUTH_RATE_LIMIT, async (_request, reply) => {
    const clientId = process.env.TRAKT_CLIENT_ID;
    const redirectUri =
      process.env.TRAKT_REDIRECT_URI ??
      `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
    if (!clientId) {
      return reply.code(500).send({ error: "TRAKT_CLIENT_ID is not configured" });
    }
    // This route is behind the API token gate, so a `state` minted here proves
    // the flow was started from Cataloggy itself — the callback below refuses
    // anything else.
    const state = await createOAuthState();
    const url = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    return reply.send({ url, redirectUri });
  });

  app.get("/trakt/oauth/callback", OAUTH_RATE_LIMIT, async (request, reply) => {
    const { code, state, error: oauthError, error_description: oauthErrorDescription } =
      request.query as { code?: string; state?: string; error?: string; error_description?: string };

    if (oauthError) {
      request.log.warn({ error: oauthError, error_description: oauthErrorDescription }, "Trakt OAuth denied");
      return reply
        .code(403)
        .type("text/html")
        .send(renderOAuthHtml(oauthErrorDescription ?? oauthError, "Trakt Authorization Failed"));
    }

    // Checked before the code is looked at, let alone exchanged: an
    // unrecognised state means this callback was not started by this install,
    // and the code it carries belongs to someone else's Trakt account.
    if (!(await consumeOAuthState(state))) {
      request.log.warn("Rejected Trakt OAuth callback with a missing, unknown or expired state");
      return reply
        .code(403)
        .type("text/html")
        .send(
          renderOAuthHtml(
            "This authorization could not be verified — it was not started from this Cataloggy install, or it took too long to complete. Start again from Settings.",
            "Trakt Authorization Failed"
          )
        );
    }

    if (!code) {
      return reply.code(400).send({ error: "Missing authorization code" });
    }

    const clientId = process.env.TRAKT_CLIENT_ID;
    const clientSecret = process.env.TRAKT_CLIENT_SECRET;
    const redirectUri =
      process.env.TRAKT_REDIRECT_URI ??
      `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;

    if (!clientId || !clientSecret) {
      return reply.code(500).send({ error: "Trakt credentials are not configured" });
    }

    const tokenExchangeController = new AbortController();
    const tokenExchangeTimeout = setTimeout(() => tokenExchangeController.abort(), 30_000);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch("https://api.trakt.tv/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Cataloggy/1.0" },
        signal: tokenExchangeController.signal,
        body: JSON.stringify({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
    } catch (err) {
      clearTimeout(tokenExchangeTimeout);
      const detail = tokenExchangeController.signal.aborted
        ? "Trakt token exchange timed out. Please try again."
        : "Could not reach Trakt servers. Please check your network and try again.";
      request.log.error(err, "Trakt token exchange fetch failed");
      return reply.code(502).type("text/html").send(renderOAuthHtml(detail));
    }
    clearTimeout(tokenExchangeTimeout);

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      request.log.error({ status: tokenResponse.status, body }, "Trakt token exchange failed");
      const contentType = tokenResponse.headers.get("content-type") ?? "";
      let detail = "Failed to exchange authorization code";
      if (!contentType.includes("json")) {
        detail =
          "Trakt's security service (Cloudflare) blocked this request before it reached Trakt's API. This is usually a temporary block on the server's outbound IP — wait a bit and try again.";
      } else if (tokenResponse.status === 401) {
        detail = "Trakt client credentials are invalid. Check TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET.";
      } else if (tokenResponse.status === 403) {
        detail = "Trakt redirect URI mismatch. Check TRAKT_REDIRECT_URI matches what is registered in your Trakt app settings.";
      }
      return reply.code(502).type("text/html").send(renderOAuthHtml(detail));
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };
    const expiresAt = computeTokenExpiresAt(tokens.expires_in);

    const accessToken = encryptSecret(SECRET_CONTEXT.traktAccessToken, tokens.access_token);
    const refreshToken = encryptSecret(SECRET_CONTEXT.traktRefreshToken, tokens.refresh_token);

    await prisma.traktToken.upsert({
      where: { id: "default" },
      update: { accessToken, refreshToken, expiresAt },
      create: { id: "default", accessToken, refreshToken, expiresAt },
    });

    resetTraktClient();

    return reply
      .type("text/html")
      .send(renderOAuthHtml("You can close this tab and return to Cataloggy.", "Trakt Connected!"));
  });

  app.post("/trakt/disconnect", async (_request, reply) => {
    await prisma.traktToken.deleteMany();
    resetTraktClient();
    return reply.send({ disconnected: true });
  });

  // Imports land in the profile that asked for them, so this route — unlike the
  // OAuth dance and the request-less /trakt/poll below — resolves the caller.
  app.post(
    "/trakt/import",
    { preHandler: resolveProfile },
    withImportLock(async (request, reply) => {
    let client: Awaited<ReturnType<typeof getTraktClient>>;
    try {
      client = await getTraktClient();
    } catch (error) {
      request.log.error(error, "Trakt client initialization failed");
      return reply.code(500).send({ error: "Trakt integration is not configured" });
    }

    const [watchedMovies, watchedShows, watchlistMovies, watchlistShows] = await Promise.all([
      client.fetchWatchedMovies(request.log),
      client.fetchWatchedShows(request.log),
      client.fetchWatchlistMovies(request.log),
      client.fetchWatchlistShows(request.log),
    ]);

    const imported = {
      movies: 0,
      episodes: 0,
      watchlistMovies: 0,
      watchlistShows: 0,
      historyMovies: 0,
      historyEpisodes: 0,
      ratings: 0,
      collectionMovies: 0,
      collectionShows: 0,
      lists: 0,
      listItems: 0,
      skipped: 0,
    };
    const profileId = request.profileId!;
    const watchlist = await getDefaultWatchlist(profileId);

    // The complete play history, every play with its own date — not just the
    // most recent watch of each item, which is all /sync/watched reports. This
    // runs first so the watched-list pass below can tell which items it already
    // covers. It also resets the incremental poll's watermark, so the scheduled
    // poll picks up from this import rather than re-walking the same history.
    const history = await pollTraktHistory(request.log, profileId, { full: true });
    imported.historyMovies = history.importedWatchEvents.movies;
    imported.historyEpisodes = history.importedWatchEvents.episodes;

    // Everything else the account holds: ratings, the collection, and personal
    // lists. Together with the history above this is the whole of what
    // Cataloggy can hold from Trakt — the point being that one run is enough to
    // stop depending on Trakt, rather than history arriving here and ratings
    // staying over there.
    const [ratings, collection, lists] = await Promise.all([
      importTraktRatings(client, request.log, profileId),
      importTraktCollection(client, request.log, profileId),
      importTraktPersonalLists(client, request.log, profileId),
    ]);
    imported.ratings = ratings.movies + ratings.shows + ratings.seasons + ratings.episodes;
    imported.collectionMovies = collection.movies;
    imported.collectionShows = collection.shows;
    imported.lists = lists.lists;
    imported.listItems = lists.items;
    imported.skipped = ratings.skipped + collection.skipped + lists.skipped;

    for (const entry of watchlistMovies) {
      const imdbId = entry.movie?.ids?.imdb;
      const title = entry.movie?.title?.trim();
      if (!imdbId) continue;

      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.movie, imdbId } },
        create: { type: ItemType.movie, imdbId, title: title || undefined },
        update: title ? { title } : {},
      });

      try {
        await prisma.listItem.create({ data: { listId: watchlist.id, type: ListItemType.movie, imdbId } });
        imported.watchlistMovies += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }

    for (const entry of watchlistShows) {
      const imdbId = entry.show?.ids?.imdb;
      const title = entry.show?.title?.trim();
      if (!imdbId) continue;

      await prisma.item.upsert({
        where: { type_imdbId: { type: ItemType.series, imdbId } },
        create: { type: ItemType.series, imdbId, title: title || undefined },
        update: title ? { title } : {},
      });

      try {
        await prisma.listItem.create({ data: { listId: watchlist.id, type: ListItemType.series, imdbId } });
        imported.watchlistShows += 1;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }

    const seriesProgressByImdb = new Map<string, SeriesProgressCandidate>();

    for (const entry of watchedMovies) {
      const imdbId = entry.movie?.ids?.imdb;
      const watchedAt = entry.last_watched_at;
      if (!imdbId || !watchedAt) continue;

      // Gap-fill only. The history import above already wrote one event per
      // play, each with its own date; overwriting one of those rows with this
      // entry's aggregate play count would count the same watches twice.
      const existing = await prisma.watchEvent.findFirst({ where: { profileId, type: "movie", imdbId } });
      if (existing) continue;

      await prisma.watchEvent.create({
        data: { type: "movie", imdbId, watchedAt: new Date(watchedAt), plays: entry.plays ?? 1, profileId },
      });
      imported.movies += 1;
    }

    for (const entry of watchedShows) {
      const seriesImdbId = entry.show?.ids?.imdb;
      if (!seriesImdbId) continue;

      for (const season of entry.seasons ?? []) {
        const seasonNumber = season.number;
        if (seasonNumber === undefined) continue;

        for (const ep of season.episodes ?? []) {
          const episodeNumber = ep.number;
          const watchedAt = ep.last_watched_at;
          if (episodeNumber === undefined || !watchedAt) continue;

          // Gap-fill only, for the same reason as the movie pass above.
          const existing = await prisma.watchEvent.findFirst({
            where: { profileId, type: "episode", seriesImdbId, season: seasonNumber, episode: episodeNumber },
          });

          if (!existing) {
            await prisma.watchEvent.create({
              data: {
                type: "episode",
                imdbId: seriesImdbId,
                seriesImdbId,
                season: seasonNumber,
                episode: episodeNumber,
                watchedAt: new Date(watchedAt),
                plays: ep.plays ?? 1,
                profileId,
              },
            });
            imported.episodes += 1;
          }

          const watchedAtDate = new Date(watchedAt);
          const existingProgress = seriesProgressByImdb.get(seriesImdbId);
          if (
            !existingProgress ||
            watchedAtDate.getTime() > existingProgress.lastWatchedAt.getTime() ||
            (watchedAtDate.getTime() === existingProgress.lastWatchedAt.getTime() &&
              (seasonNumber > existingProgress.lastSeason ||
                (seasonNumber === existingProgress.lastSeason &&
                  episodeNumber > existingProgress.lastEpisode)))
          ) {
            seriesProgressByImdb.set(seriesImdbId, {
              lastSeason: seasonNumber,
              lastEpisode: episodeNumber,
              lastWatchedAt: watchedAtDate,
            });
          }
        }
      }
    }

    for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
      await upsertSeriesProgressIfNewer(profileId, seriesImdbId, progress);
    }

    // Every title this import touched, whatever brought it in. A film that was
    // only rated or only collected has no other reason to be fetched from TMDB,
    // and without this would show as a bare IMDb id.
    const seriesImdbIds = [
      ...new Set([
        ...watchedShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
        ...watchlistShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
        ...ratings.imdbIds.series,
        ...collection.imdbIds.series,
        ...lists.imdbIds.series,
      ]),
    ];
    const allMovieIds = [
      ...new Set([
        ...watchedMovies.map((e) => e.movie?.ids?.imdb).filter((id): id is string => !!id),
        ...watchlistMovies.map((e) => e.movie?.ids?.imdb).filter((id): id is string => !!id),
        ...ratings.imdbIds.movies,
        ...collection.imdbIds.movies,
        ...lists.imdbIds.movies,
      ]),
    ];

    // Only the titles that have no metadata row yet. Re-running an import used
    // to re-fetch every title in the library from TMDB, and this import widened
    // that set to everything rated, collected or listed — a request per title,
    // for rows that were already there.
    const [knownMovies, knownSeries] = await Promise.all([
      prisma.metadata.findMany({
        where: { type: MetadataType.movie, imdbId: { in: allMovieIds } },
        select: { imdbId: true },
      }),
      prisma.metadata.findMany({
        where: { type: MetadataType.series, imdbId: { in: seriesImdbIds } },
        select: { imdbId: true },
      }),
    ]);
    const knownMovieIds = new Set(knownMovies.map((row) => row.imdbId));
    const knownSeriesIds = new Set(knownSeries.map((row) => row.imdbId));
    const missingMovieIds = allMovieIds.filter((id) => !knownMovieIds.has(id));
    const missingSeriesIds = seriesImdbIds.filter((id) => !knownSeriesIds.has(id));

    void (async () => {
      try {
        const tmdb = await getTmdb();
        for (const id of missingMovieIds) {
          try {
            const payload = await tmdb.findByImdbId(MetadataType.movie, id);
            if (payload) await upsertMetadata(payload);
          } catch (error) {
            request.log.warn({ imdbId: id, error }, "Trakt import: movie metadata backfill failed");
          }
        }
        for (const id of missingSeriesIds) {
          try {
            const payload = await tmdb.findByImdbId(MetadataType.series, id);
            if (payload) await upsertMetadata(payload);
          } catch (error) {
            request.log.warn({ imdbId: id, error }, "Trakt import: series metadata backfill failed");
          }
        }
      } catch (error) {
        request.log.warn(error, "Trakt import: TMDB unavailable for metadata backfill");
      }
    })();

    return reply.code(200).send({ imported });
    })
  );

  // `{ "full": true }` forces a complete history backfill instead of resuming
  // from the last poll — the way to recover history an earlier windowed sync
  // never imported, without disconnecting and reconnecting the account.
  app.post("/trakt/poll", async (request, reply) => {
    try {
      const { full } = (request.body ?? {}) as { full?: boolean };
      const profileId = await getDefaultProfileId();
      const history = await pollTraktHistory(request.log, profileId, { full: full === true });
      const watchlist = await syncTraktWatchlist(request.log, profileId);
      return reply.code(200).send({ ...history, watchlist });
    } catch (error) {
      request.log.error(error, "Trakt poll failed");
      return reply.code(500).send({ error: "Trakt poll failed" });
    }
  });
};

export default traktRoutes;
