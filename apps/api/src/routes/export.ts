import { ListItemType, ListKind, MetadataType, Prisma, WatchEventType } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { resolveProfile } from "../lib/profile.js";
import { upsertSeriesProgressIfNewer } from "../lib/series-progress.js";
import { getDefaultWatchlist } from "../lib/watchlist.js";

const EXPORT_VERSION = 1;

interface ExportListItem {
  type: ListItemType;
  imdbId: string;
  addedAt: string;
}

interface ExportList {
  name: string;
  kind: ListKind;
  items: ExportListItem[];
}

interface ExportWatchEvent {
  type: WatchEventType;
  imdbId: string;
  seriesImdbId: string | null;
  season: number | null;
  episode: number | null;
  watchedAt: string;
  plays: number;
  note?: string | null;
}

interface ExportSeriesProgress {
  seriesImdbId: string;
  lastSeason: number;
  lastEpisode: number;
  lastWatchedAt: string;
}

interface ExportRating {
  imdbId: string;
  type: string;
  season?: number;
  episode?: number;
  rating: number;
  note?: string | null;
  ratedAt: string;
}

interface ExportPayload {
  version: number;
  exportedAt: string;
  profile: { name: string };
  lists: ExportList[];
  watchEvents: ExportWatchEvent[];
  seriesProgress: ExportSeriesProgress[];
  ratings: ExportRating[];
}

const isString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const parseDate = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get("/export", async (request) => {
    const profileId = request.profileId!;

    const [profile, lists, watchEvents, seriesProgress, ratingRows] = await Promise.all([
      prisma.profile.findUnique({ where: { id: profileId }, select: { name: true } }),
      prisma.list.findMany({
        where: { profileId },
        include: { items: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.watchEvent.findMany({ where: { profileId }, orderBy: { watchedAt: "asc" } }),
      prisma.seriesProgress.findMany({ where: { profileId } }),
      prisma.rating.findMany({ where: { profileId } }),
    ]);

    const ratings: ExportRating[] = ratingRows.map((row) => ({
      imdbId: row.imdbId,
      type: row.type,
      season: row.type === "episode" ? row.season : undefined,
      episode: row.type === "episode" ? row.episode : undefined,
      rating: row.rating,
      note: row.note,
      ratedAt: row.ratedAt.toISOString(),
    }));

    const payload: ExportPayload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: { name: profile?.name ?? "Default" },
      lists: lists.map((list) => ({
        name: list.name,
        kind: list.kind,
        items: list.items.map((item) => ({
          type: item.type,
          imdbId: item.imdbId,
          addedAt: item.addedAt.toISOString(),
        })),
      })),
      watchEvents: watchEvents.map((event) => ({
        type: event.type,
        imdbId: event.imdbId,
        seriesImdbId: event.seriesImdbId,
        season: event.season,
        episode: event.episode,
        watchedAt: event.watchedAt.toISOString(),
        plays: event.plays,
        note: event.note,
      })),
      seriesProgress: seriesProgress.map((sp) => ({
        seriesImdbId: sp.seriesImdbId,
        lastSeason: sp.lastSeason,
        lastEpisode: sp.lastEpisode,
        lastWatchedAt: sp.lastWatchedAt.toISOString(),
      })),
      ratings,
    };

    return payload;
  });

  app.post<{ Body: unknown }>("/import", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as Partial<ExportPayload> | null;

    if (!body || typeof body !== "object" || body.version !== EXPORT_VERSION) {
      return reply.code(400).send({ error: `Expected an export payload with version ${EXPORT_VERSION}` });
    }

    const summary = { lists: 0, listItems: 0, watchEvents: 0, seriesProgress: 0, ratings: 0 };

    for (const list of Array.isArray(body.lists) ? body.lists : []) {
      if (!isString(list.name) || !Object.values(ListKind).includes(list.kind)) continue;

      const targetList =
        list.kind === ListKind.watchlist
          ? await getDefaultWatchlist(profileId)
          : await (async () => {
              const existing = await prisma.list.findFirst({
                where: { profileId, kind: ListKind.custom, name: list.name.trim() },
              });
              if (existing) return existing;
              summary.lists += 1;
              return prisma.list.create({
                data: { profileId, kind: ListKind.custom, name: list.name.trim() },
              });
            })();

      for (const item of Array.isArray(list.items) ? list.items : []) {
        if (!Object.values(ListItemType).includes(item.type) || !isString(item.imdbId)) continue;
        const addedAt = parseDate(item.addedAt) ?? new Date();

        try {
          await prisma.listItem.create({
            data: { listId: targetList.id, type: item.type, imdbId: item.imdbId.trim(), addedAt },
          });
          summary.listItems += 1;
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        }
      }
    }

    for (const event of Array.isArray(body.watchEvents) ? body.watchEvents : []) {
      if (!Object.values(WatchEventType).includes(event.type) || !isString(event.imdbId)) continue;
      const watchedAt = parseDate(event.watchedAt);
      if (!watchedAt) continue;

      const season = isFiniteNumber(event.season) ? event.season : null;
      const episode = isFiniteNumber(event.episode) ? event.episode : null;
      const seriesImdbId = isString(event.seriesImdbId) ? event.seriesImdbId.trim() : null;
      const imdbId = event.imdbId.trim();
      const matchImdbId = event.type === WatchEventType.episode ? seriesImdbId ?? imdbId : imdbId;

      const dayStart = new Date(watchedAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(watchedAt);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const existing = await prisma.watchEvent.findFirst({
        where: {
          profileId,
          type: event.type,
          ...(event.type === WatchEventType.episode
            ? { seriesImdbId: matchImdbId }
            : { imdbId: matchImdbId }),
          season,
          episode,
          watchedAt: { gte: dayStart, lte: dayEnd },
        },
      });

      if (existing) {
        await prisma.watchEvent.update({
          where: { id: existing.id },
          data: { plays: { increment: isFiniteNumber(event.plays) ? event.plays : 1 } },
        });
      } else {
        await prisma.watchEvent.create({
          data: {
            type: event.type,
            imdbId,
            seriesImdbId,
            season,
            episode,
            watchedAt,
            plays: isFiniteNumber(event.plays) ? event.plays : 1,
            note: isString(event.note) ? event.note : null,
            profileId,
          },
        });
      }
      summary.watchEvents += 1;
    }

    for (const sp of Array.isArray(body.seriesProgress) ? body.seriesProgress : []) {
      if (!isString(sp.seriesImdbId) || !isFiniteNumber(sp.lastSeason) || !isFiniteNumber(sp.lastEpisode)) {
        continue;
      }
      const lastWatchedAt = parseDate(sp.lastWatchedAt);
      if (!lastWatchedAt) continue;

      await upsertSeriesProgressIfNewer(profileId, sp.seriesImdbId.trim(), {
        lastSeason: sp.lastSeason,
        lastEpisode: sp.lastEpisode,
        lastWatchedAt,
      });
      summary.seriesProgress += 1;
    }

    for (const rating of Array.isArray(body.ratings) ? body.ratings : []) {
      if (
        !isString(rating.imdbId) ||
        (rating.type !== "movie" && rating.type !== "series" && rating.type !== "episode") ||
        !isFiniteNumber(rating.rating)
      ) {
        continue;
      }
      const ratedAt = parseDate(rating.ratedAt) ?? new Date();
      const imdbId = rating.imdbId.trim();
      const type = rating.type as MetadataType;
      const season = type === "episode" && isFiniteNumber(rating.season) ? rating.season : 0;
      const episode = type === "episode" && isFiniteNumber(rating.episode) ? rating.episode : 0;
      const note = isString(rating.note) ? rating.note : null;

      await prisma.rating.upsert({
        where: { profileId_type_imdbId_season_episode: { profileId, type, imdbId, season, episode } },
        create: { profileId, type, imdbId, season, episode, rating: rating.rating, ratedAt, note },
        update: { rating: rating.rating, ratedAt, note },
      });
      summary.ratings += 1;
    }

    return reply.code(200).send({ status: "imported", summary });
  });

  app.post<{ Body: unknown }>("/import/csv", async (request, reply) => {
    const profileId = request.profileId!;
    const body = request.body as { csv?: unknown } | null;
    if (!body || typeof body.csv !== "string" || !body.csv.trim()) {
      return reply.code(400).send({ error: "csv is required" });
    }

    const rows = parseCsv(body.csv);
    if (rows.length === 0) {
      return reply.code(400).send({ error: "No rows found in CSV" });
    }

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const imdbIdCol = col("imdbid");
    const typeCol = col("type");
    const seasonCol = col("season");
    const episodeCol = col("episode");
    const watchedAtCol = col("watchedat");

    if (imdbIdCol === -1 || typeCol === -1 || watchedAtCol === -1) {
      return reply.code(400).send({
        error: "CSV header must include at least: imdbId,type,watchedAt (season,episode optional)",
      });
    }

    let imported = 0;
    let skipped = 0;

    for (const row of rows.slice(1)) {
      if (row.length === 0 || row.every((cell) => cell.trim() === "")) continue;

      const imdbId = row[imdbIdCol]?.trim();
      const rawType = row[typeCol]?.trim().toLowerCase();
      const watchedAt = parseDate(row[watchedAtCol]?.trim());

      if (!imdbId || (rawType !== "movie" && rawType !== "episode") || !watchedAt) {
        skipped += 1;
        continue;
      }

      const season = seasonCol !== -1 && row[seasonCol]?.trim() ? Number(row[seasonCol]) : null;
      const episode = episodeCol !== -1 && row[episodeCol]?.trim() ? Number(row[episodeCol]) : null;
      const type = rawType as WatchEventType;
      const seriesImdbId = type === "episode" ? imdbId : null;

      const dayStart = new Date(watchedAt);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(watchedAt);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const existing = await prisma.watchEvent.findFirst({
        where: {
          profileId,
          type,
          imdbId,
          season: Number.isFinite(season) ? season : null,
          episode: Number.isFinite(episode) ? episode : null,
          watchedAt: { gte: dayStart, lte: dayEnd },
        },
      });

      if (existing) {
        await prisma.watchEvent.update({ where: { id: existing.id }, data: { plays: { increment: 1 } } });
      } else {
        await prisma.watchEvent.create({
          data: {
            type,
            imdbId,
            seriesImdbId,
            season: Number.isFinite(season) ? season : null,
            episode: Number.isFinite(episode) ? episode : null,
            watchedAt,
            profileId,
          },
        });
      }
      imported += 1;
    }

    return reply.code(200).send({ status: "imported", summary: { imported, skipped } });
  });
};

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 0);
}

export default exportRoutes;
