import type { FastifyPluginAsync } from "fastify";
import { getUpcomingEpisodes } from "../lib/upcoming-episodes.js";

const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { days?: string } }>("/calendar", async (request) => {
    const daysAhead = Math.min(Math.max(Number(request.query.days) || 30, 1), 90);
    const calendar = await getUpcomingEpisodes(daysAhead);
    return { calendar };
  });
};

export default calendarRoutes;
