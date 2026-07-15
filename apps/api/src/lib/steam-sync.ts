import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { getSteam } from "./steam-client.js";
import { getIgdb } from "./igdb-client.js";

export const isSteamSyncConfigured = (): boolean =>
  !!process.env.STEAM_API_KEY?.trim() && !!process.env.STEAM_ID?.trim();

export type SteamSyncSummary = {
  total: number;
  created: number;
  updated: number;
  matched: number;
  unmatched: number;
};

/**
 * One-way import of the configured Steam account's library into the Games
 * table, modeled on pollTraktHistory: existing rows get their playtime/last-
 * played refreshed, new rows are created immediately from Steam data alone
 * (so they show up even if IGDB matching below fails) and then best-effort
 * matched against IGDB by title to fill in artwork/genres/release date.
 * Manual rating/notes/finished fields on existing rows are never touched.
 */
export const syncSteamLibrary = async (
  logger: FastifyRequest["log"],
  profileId: string
): Promise<SteamSyncSummary> => {
  const steamId = process.env.STEAM_ID?.trim();
  if (!steamId) {
    throw new Error("STEAM_ID is not configured");
  }

  const steam = getSteam();
  const ownedGames = await steam.getOwnedGames(steamId);

  const summary: SteamSyncSummary = { total: ownedGames.length, created: 0, updated: 0, matched: 0, unmatched: 0 };

  for (const game of ownedGames) {
    const existing = await prisma.game.findFirst({ where: { profileId, steamAppId: game.appId } });

    if (existing) {
      await prisma.game.update({
        where: { id: existing.id },
        data: {
          playtimeMinutes: game.playtimeForeverMinutes,
          lastPlayedAt: game.lastPlayedAt ?? existing.lastPlayedAt,
          // IGDB artwork, once matched, takes priority over the Steam icon.
          coverUrl: existing.coverUrl ?? game.iconUrl ?? undefined
        }
      });
      summary.updated += 1;
      continue;
    }

    const created = await prisma.game.create({
      data: {
        profileId,
        steamAppId: game.appId,
        title: game.name,
        coverUrl: game.iconUrl,
        playtimeMinutes: game.playtimeForeverMinutes,
        lastPlayedAt: game.lastPlayedAt
      }
    });
    summary.created += 1;

    try {
      const match = await getIgdb().findBestMatch(game.name);
      if (!match) {
        summary.unmatched += 1;
        continue;
      }

      try {
        await prisma.game.update({
          where: { id: created.id },
          data: {
            igdbId: match.igdbId,
            coverUrl: match.coverUrl ?? created.coverUrl ?? undefined,
            releaseDate: match.releaseDate ? new Date(match.releaseDate) : null,
            genres: match.genres
          }
        });
        summary.matched += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          logger.warn(
            { igdbId: match.igdbId, title: game.name },
            "IGDB match is already linked to another game in this library; leaving unmatched"
          );
          summary.unmatched += 1;
        } else {
          throw error;
        }
      }
    } catch (error) {
      // Covers IGDB not being configured (Twitch credentials unset) and any
      // transient IGDB failure — the Steam-derived row above already stands
      // on its own without artwork/genres.
      logger.warn({ error, title: game.name }, "IGDB match lookup failed during Steam sync");
      summary.unmatched += 1;
    }
  }

  return summary;
};
