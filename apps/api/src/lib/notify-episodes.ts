import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getUpcomingEpisodes } from "./upcoming-episodes.js";
import { sendPushToAllSubscriptions } from "./push.js";

export const checkUpcomingEpisodesAndNotify = async (log: FastifyBaseLogger): Promise<void> => {
  const subscriptionCount = await prisma.pushSubscription.count();
  if (subscriptionCount === 0) return;

  const airingToday = await getUpcomingEpisodes(0, null);
  if (airingToday.length === 0) return;

  for (const ep of airingToday) {
    try {
      await sendPushToAllSubscriptions({
        title: `${ep.seriesName} — new episode today`,
        body: `S${ep.season}E${ep.episode} "${ep.episodeName}" airs today`,
        url: "/calendar",
      });
    } catch (error) {
      log.error({ error, seriesImdbId: ep.seriesImdbId }, "Failed to send episode push notification");
      // Don't mark as notified, so the next scheduled run retries delivery.
      continue;
    }

    try {
      // Unique constraint on (seriesImdbId, season, episode) makes this an
      // atomic claim: if the row already exists, this episode was already
      // notified and we skip recording it again.
      await prisma.notifiedEpisode.create({
        data: { seriesImdbId: ep.seriesImdbId, season: ep.season, episode: ep.episode },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }
};
