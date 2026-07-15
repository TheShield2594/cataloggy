import { Prisma } from "@prisma/client";
import type { Game } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { getSteam } from "./steam-client.js";
import { getIgdb } from "./igdb-client.js";
import type { SteamOwnedGame } from "../steam.js";
import type { IgdbGameSummary } from "../igdb.js";

export const isSteamSyncConfigured = (): boolean =>
  !!process.env.STEAM_API_KEY?.trim() && !!process.env.STEAM_ID?.trim();

export type SteamSyncSummary = {
  total: number;
  created: number;
  updated: number;
  matched: number;
  unmatched: number;
};

type Logger = FastifyRequest["log"];
type ExistingGameRow = Pick<Game, "id" | "igdbId" | "coverUrl" | "lastPlayedAt">;

// Resolves an IGDB match for a Steam title. Covers IGDB not being configured (Twitch
// credentials unset) and any transient IGDB failure identically: best-effort only,
// this never fails the sync — the Steam-derived data always stands on its own.
async function tryFindIgdbMatch(title: string, logger: Logger): Promise<IgdbGameSummary | null> {
  try {
    return await getIgdb().findBestMatch(title);
  } catch (error) {
    logger.warn({ error, title }, "IGDB match lookup failed during Steam sync");
    return null;
  }
}

function playtimeUpdateData(existing: Pick<Game, "coverUrl" | "lastPlayedAt">, steamGame: SteamOwnedGame) {
  return {
    playtimeMinutes: steamGame.playtimeForeverMinutes,
    lastPlayedAt: steamGame.lastPlayedAt ?? existing.lastPlayedAt,
    // IGDB artwork, once matched, takes priority over the Steam icon.
    coverUrl: existing.coverUrl ?? steamGame.iconUrl ?? undefined
  };
}

// Attaches IGDB metadata to a Steam-only row that wasn't matched on a previous sync
// (e.g. because IGDB wasn't configured yet, or no confident match existed at the time).
async function enrichExistingRow(
  row: ExistingGameRow,
  game: SteamOwnedGame,
  summary: SteamSyncSummary,
  logger: Logger
): Promise<void> {
  const match = await tryFindIgdbMatch(game.name, logger);
  if (!match) {
    summary.unmatched += 1;
    return;
  }

  try {
    await prisma.game.update({
      where: { id: row.id },
      data: {
        igdbId: match.igdbId,
        coverUrl: row.coverUrl ?? match.coverUrl ?? undefined,
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
}

/**
 * One-way import of the configured Steam account's library into the Games table,
 * modeled on pollTraktHistory:
 * - A Steam game already linked (by steamAppId) just gets playtime/last-played
 *   refreshed. If it has no IGDB link yet, a match is retried so it can be
 *   enriched once IGDB becomes available (or a confident match appears).
 * - A new Steam game is matched against IGDB *before* anything is written, so a
 *   pre-existing row for the same game (e.g. manually added earlier via search)
 *   is linked instead of duplicated. Only when no existing row is found is a new
 *   one created, already carrying any IGDB match found.
 * Manual rating/notes/finished fields on existing rows are never touched.
 */
export const syncSteamLibrary = async (logger: Logger, profileId: string): Promise<SteamSyncSummary> => {
  const steamId = process.env.STEAM_ID?.trim();
  if (!steamId) {
    throw new Error("STEAM_ID is not configured");
  }

  const steam = getSteam();
  const ownedGames = await steam.getOwnedGames(steamId);

  const summary: SteamSyncSummary = { total: ownedGames.length, created: 0, updated: 0, matched: 0, unmatched: 0 };

  for (const game of ownedGames) {
    const existingBySteamAppId = await prisma.game.findFirst({ where: { profileId, steamAppId: game.appId } });

    if (existingBySteamAppId) {
      await prisma.game.update({
        where: { id: existingBySteamAppId.id },
        data: playtimeUpdateData(existingBySteamAppId, game)
      });
      summary.updated += 1;

      if (existingBySteamAppId.igdbId === null) {
        await enrichExistingRow(existingBySteamAppId, game, summary, logger);
      }
      continue;
    }

    const match = await tryFindIgdbMatch(game.name, logger);

    if (match) {
      const existingByIgdbId = await prisma.game.findFirst({ where: { profileId, igdbId: match.igdbId } });
      if (existingByIgdbId) {
        await prisma.game.update({
          where: { id: existingByIgdbId.id },
          data: {
            steamAppId: game.appId,
            playtimeMinutes: game.playtimeForeverMinutes,
            lastPlayedAt: game.lastPlayedAt ?? existingByIgdbId.lastPlayedAt,
            coverUrl: existingByIgdbId.coverUrl ?? match.coverUrl ?? game.iconUrl ?? undefined
          }
        });
        summary.updated += 1;
        summary.matched += 1;
        continue;
      }
    }

    try {
      await prisma.game.create({
        data: {
          profileId,
          steamAppId: game.appId,
          igdbId: match?.igdbId,
          title: game.name,
          coverUrl: match?.coverUrl ?? game.iconUrl,
          releaseDate: match?.releaseDate ? new Date(match.releaseDate) : null,
          genres: match?.genres ?? [],
          playtimeMinutes: game.playtimeForeverMinutes,
          lastPlayedAt: game.lastPlayedAt
        }
      });
      summary.created += 1;
      if (match) summary.matched += 1;
      else summary.unmatched += 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;

      // Rare race: a concurrent sync (e.g. a manual "Sync now" overlapping the
      // scheduled run) created or linked a row for this steamAppId/igdbId between
      // the lookups above and this create. Re-read and update it instead of
      // failing the whole sync.
      const raced =
        (await prisma.game.findFirst({ where: { profileId, steamAppId: game.appId } })) ??
        (match ? await prisma.game.findFirst({ where: { profileId, igdbId: match.igdbId } }) : null);
      if (!raced) throw error;

      await prisma.game.update({
        where: { id: raced.id },
        data: { steamAppId: game.appId, ...playtimeUpdateData(raced, game) }
      });
      summary.updated += 1;
    }
  }

  return summary;
};
