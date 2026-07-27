import { ItemType, ListItemType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getRpdbApiKey, withRpdbPoster } from "./rpdb.js";
import { getDefaultWatchlist } from "./watchlist.js";
import { getDroppedSeriesIds } from "./dropped-shows.js";
import { backfillMissingMetadata } from "./metadata.js";
import type { ContinueMetaPreview, StremioMetaPreview, StremioMetaType } from "./types.js";

export const buildMetasFromIds = async (
  ids: string[],
  type: StremioMetaType
): Promise<StremioMetaPreview[]> => {
  if (ids.length === 0) return [];

  const itemType = type === "movie" ? ItemType.movie : ItemType.series;
  const metadataType = type === "movie" ? ("movie" as const) : ("series" as const);

  const [items, metadata, rpdbKey] = await Promise.all([
    prisma.item.findMany({
      where: { type: itemType, imdbId: { in: ids } },
      select: { imdbId: true, title: true },
    }),
    prisma.metadata.findMany({
      where: { imdbId: { in: ids }, type: metadataType },
      select: { imdbId: true, name: true, poster: true, year: true, description: true, genres: true, rating: true },
    }),
    getRpdbApiKey(),
  ]);

  const titleByImdbId = new Map(items.map((item) => [item.imdbId, item.title?.trim() ?? ""]));
  const metadataByImdbId = new Map(metadata.map((entry) => [entry.imdbId, entry]));

  // Without a metadata row these metas carry no poster, year, or genres — repair
  // them in the background so the catalog fills in on the next request.
  const missing = ids.filter((id) => !metadataByImdbId.has(id));
  if (missing.length > 0) {
    backfillMissingMetadata(missing.map((imdbId) => ({ imdbId, type: metadataType })));
  }

  return ids.map((id) => {
    const meta = metadataByImdbId.get(id);
    return {
      id,
      type,
      name: titleByImdbId.get(id) || meta?.name || id,
      poster: withRpdbPoster(id, meta?.poster, rpdbKey) ?? undefined,
      year: meta?.year ?? undefined,
      description: meta?.description ?? undefined,
      genres: meta?.genres ?? [],
      rating: meta?.rating ?? undefined,
    };
  });
};

const sortMetasByName = <T extends { name: string }>(metas: T[]): T[] =>
  [...metas].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

export const getWatchlistMetas = async (type: StremioMetaType, limit: number, profileId: string) => {
  const watchlist = await getDefaultWatchlist(profileId);
  const listItemType = type === "movie" ? ListItemType.movie : ListItemType.series;

  const watchlistItems = await prisma.listItem.findMany({
    where: { listId: watchlist.id, type: listItemType },
    select: { imdbId: true },
  });

  const metas = await buildMetasFromIds(
    watchlistItems.map((item) => item.imdbId),
    type
  );
  return sortMetasByName(metas).slice(0, limit);
};

export const getRecentMetas = async (type: StremioMetaType, limit: number, profileId: string) => {
  if (type === "movie") {
    const grouped = await prisma.watchEvent.groupBy({
      by: ["imdbId"],
      where: { type: "movie", profileId },
      _max: { watchedAt: true },
      orderBy: { _max: { watchedAt: "desc" } },
      take: limit,
    });
    return buildMetasFromIds(grouped.map((e) => e.imdbId), type);
  }

  const grouped = await prisma.watchEvent.groupBy({
    by: ["seriesImdbId"],
    where: { type: "episode", seriesImdbId: { not: null }, profileId },
    _max: { watchedAt: true },
    orderBy: { _max: { watchedAt: "desc" } },
    take: limit,
  });

  const ids = grouped
    .map((e) => e.seriesImdbId)
    .filter((id): id is string => Boolean(id));

  return buildMetasFromIds(ids, type);
};

export const getContinueMetas = async (limit: number, profileId: string): Promise<ContinueMetaPreview[]> => {
  const allProgress = await prisma.seriesProgress.findMany({
    where: { profileId },
    orderBy: { lastWatchedAt: "desc" },
    select: { seriesImdbId: true, lastSeason: true, lastEpisode: true, lastWatchedAt: true },
  });

  const droppedIds = await getDroppedSeriesIds(profileId, allProgress.map((p) => p.seriesImdbId));
  const seriesProgress = allProgress.filter((p) => !droppedIds.has(p.seriesImdbId)).slice(0, limit);

  const metas = await buildMetasFromIds(
    seriesProgress.map((p) => p.seriesImdbId),
    "series"
  );

  const progressBySeriesId = new Map(
    seriesProgress.map((p) => [p.seriesImdbId, p])
  );

  return metas
    .map((meta) => {
      const progress = progressBySeriesId.get(meta.id);
      if (!progress) return null;
      return {
        ...meta,
        extension: { season: progress.lastSeason, episode: progress.lastEpisode },
        lastWatched: {
          season: progress.lastSeason,
          episode: progress.lastEpisode,
          lastWatchedAt: progress.lastWatchedAt.toISOString(),
        },
      };
    })
    .filter((meta): meta is ContinueMetaPreview => Boolean(meta));
};

export const getCustomListMetas = async (
  listId: string,
  type: StremioMetaType,
  limit: number
) => {
  const listItemType = type === "movie" ? ListItemType.movie : ListItemType.series;
  const listItems = await prisma.listItem.findMany({
    where: { listId, type: listItemType },
    select: { imdbId: true },
  });

  const metas = await buildMetasFromIds(
    listItems.map((item) => item.imdbId),
    type
  );
  return sortMetasByName(metas).slice(0, limit);
};
