import type { FastifyPluginAsync } from "fastify";
import { getUpcomingEpisodes } from "../lib/upcoming-episodes.js";
import { resolveProfile } from "../lib/profile.js";

const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", resolveProfile);

  app.get<{ Querystring: { days?: string } }>("/calendar", async (request) => {
    const daysAhead = Math.min(Math.max(Number(request.query.days) || 30, 1), 90);
    const calendar = await getUpcomingEpisodes(request.profileId!, daysAhead);
    return { calendar };
  });
};

export default calendarRoutes;
