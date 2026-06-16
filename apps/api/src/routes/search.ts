import { ListItemType, ListKind } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { upsertMetadata } from "../lib/metadata.js";
import { getRpdbApiKey, withRpdbPoster } from "../lib/rpdb.js";
import { getMetadataType } from "../lib/types.js";
import { getTmdb } from "../lib/tmdb-client.js";

const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { type?: string; query?: string; q?: string } }>(
    "/search",
    async (request, reply) => {
      const rawType = request.query.type ?? "all";
      const isAll = rawType === "all";
      const type = isAll ? null : getMetadataType(rawType);
      if (!isAll && !type) {
        return reply.code(400).send({ error: "type must be one of: movie, series, all" });
      }

      const query = (request.query.q ?? request.query.query)?.trim();
      if (!query) {
        return reply.code(400).send({ error: "q or query is required" });
      }

      let tmdb: Awaited<ReturnType<typeof getTmdb>>;
      try {
        tmdb = await getTmdb();
      } catch (error) {
        request.log.error(error, "TMDB client initialization failed");
        return reply.code(500).send({ error: "TMDB integration is not configured" });
      }

      const allResults = isAll
        ? await tmdb.searchMulti(query)
        : await tmdb.search(type!, query);

      const results = allResults.slice(0, 20);

      await Promise.all(results.map((result) => upsertMetadata(result)));

      const imdbIds = results.map((r) => r.imdbId);
      const resultTypes = [...new Set(results.map((r) => r.type as ListItemType))];

      const [listItems, rpdbKey] = await Promise.all([
        prisma.listItem.findMany({
          where: { imdbId: { in: imdbIds }, type: { in: resultTypes } },
          include: { list: { select: { id: true, name: true, kind: true } } },
        }),
        getRpdbApiKey(),
      ]);

      const listInfoKey = (imdbId: string, mediaType: string) => `${mediaType}:${imdbId}`;
      const listInfoByKey = new Map<string, { inWatchlist: boolean; lists: string[] }>();
      for (const item of listItems) {
        const key = listInfoKey(item.imdbId, item.type);
        let info = listInfoByKey.get(key);
        if (!info) {
          info = { inWatchlist: false, lists: [] };
          listInfoByKey.set(key, info);
        }
        if (item.list.kind === ListKind.watchlist) info.inWatchlist = true;
        info.lists.push(item.list.id);
      }

      return results.map((result) => {
        const info = listInfoByKey.get(listInfoKey(result.imdbId, result.type));
        return {
          imdbId: result.imdbId,
          type: result.type,
          name: result.name,
          year: result.year,
          poster: withRpdbPoster(result.imdbId, result.poster, rpdbKey),
          description: result.description,
          genres: result.genres,
          rating: result.rating,
          inWatchlist: info?.inWatchlist ?? false,
          lists: info?.lists ?? [],
        };
      });
    }
  );
};

export default searchRoutes;
