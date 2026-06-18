import { ItemType, ListItemType, MetadataType, Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
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
import { renderOAuthHtml } from "../lib/html.js";
import { getDefaultProfileId } from "../lib/profile.js";
import type { SeriesProgressCandidate } from "../lib/types.js";

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

  app.get("/trakt/oauth/authorize", async (_request, reply) => {
    const clientId = process.env.TRAKT_CLIENT_ID;
    const redirectUri =
      process.env.TRAKT_REDIRECT_URI ??
      `${process.env.CATALOGGY_API_PUBLIC ?? "http://localhost:7000"}/trakt/oauth/callback`;
    if (!clientId) {
      return reply.code(500).send({ error: "TRAKT_CLIENT_ID is not configured" });
    }
    const url = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    return reply.send({ url, redirectUri });
  });

  app.get("/trakt/oauth/callback", async (request, reply) => {
    const { code, error: oauthError, error_description: oauthErrorDescription } =
      request.query as { code?: string; error?: string; error_description?: string };

    if (oauthError) {
      request.log.warn({ error: oauthError, error_description: oauthErrorDescription }, "Trakt OAuth denied");
      return reply
        .code(403)
        .type("text/html")
        .send(renderOAuthHtml(oauthErrorDescription ?? oauthError, "Trakt Authorization Failed"));
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

    await prisma.traktToken.upsert({
      where: { id: "default" },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
      create: {
        id: "default",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
      },
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

  app.post("/trakt/import", async (request, reply) => {
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

    const imported = { movies: 0, episodes: 0, watchlistMovies: 0, watchlistShows: 0 };
    const profileId = await getDefaultProfileId();
    const watchlist = await getDefaultWatchlist(profileId);

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

      const existing = await prisma.watchEvent.findFirst({ where: { profileId, type: "movie", imdbId } });
      if (existing) {
        await prisma.watchEvent.update({
          where: { id: existing.id },
          data: { watchedAt: new Date(watchedAt), plays: entry.plays ?? 1 },
        });
      } else {
        await prisma.watchEvent.create({
          data: { type: "movie", imdbId, watchedAt: new Date(watchedAt), plays: entry.plays ?? 1, profileId },
        });
      }
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

          const existing = await prisma.watchEvent.findFirst({
            where: { profileId, type: "episode", seriesImdbId, season: seasonNumber, episode: episodeNumber },
          });

          if (existing) {
            await prisma.watchEvent.update({
              where: { id: existing.id },
              data: { watchedAt: new Date(watchedAt), plays: ep.plays ?? 1 },
            });
          } else {
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

          imported.episodes += 1;
        }
      }
    }

    for (const [seriesImdbId, progress] of seriesProgressByImdb.entries()) {
      await upsertSeriesProgressIfNewer(profileId, seriesImdbId, progress);
    }

    const movieImdbIds = watchedMovies
      .map((e) => e.movie?.ids?.imdb)
      .filter((id): id is string => !!id);
    const seriesImdbIds = [
      ...new Set([
        ...watchedShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
        ...watchlistShows.map((e) => e.show?.ids?.imdb).filter((id): id is string => !!id),
      ]),
    ];
    const watchlistMovieImdbIds = watchlistMovies
      .map((e) => e.movie?.ids?.imdb)
      .filter((id): id is string => !!id);
    const allMovieIds = [...new Set([...movieImdbIds, ...watchlistMovieImdbIds])];

    void (async () => {
      try {
        const tmdb = await getTmdb();
        for (const id of allMovieIds) {
          try {
            const payload = await tmdb.findByImdbId(MetadataType.movie, id);
            if (payload) await upsertMetadata(payload);
          } catch (error) {
            request.log.warn({ imdbId: id, error }, "Trakt import: movie metadata backfill failed");
          }
        }
        for (const id of seriesImdbIds) {
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
  });

  app.post("/trakt/poll", async (request, reply) => {
    try {
      const profileId = await getDefaultProfileId();
      const history = await pollTraktHistory(request.log, profileId);
      const watchlist = await syncTraktWatchlist(request.log, profileId);
      return reply.code(200).send({ ...history, watchlist });
    } catch (error) {
      request.log.error(error, "Trakt poll failed");
      return reply.code(500).send({ error: "Trakt poll failed" });
    }
  });
};

export default traktRoutes;
