import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getUpcomingEpisodes } from "./upcoming-episodes.js";
import { sendPushToAllSubscriptions } from "./push.js";

export const checkUpcomingEpisodesAndNotify = async (log: FastifyBaseLogger): Promise<void> => {
  // Push subscriptions are per-profile, so only profiles with at least one
  // subscription need to be checked for upcoming episodes.
  const subscriptions = await prisma.pushSubscription.findMany({
    select: { profileId: true },
    distinct: ["profileId"],
  });
  if (subscriptions.length === 0) return;

  for (const { profileId } of subscriptions) {
    const airingToday = await getUpcomingEpisodes(profileId, 0, null);
    if (airingToday.length === 0) continue;

    for (const ep of airingToday) {
      try {
        await sendPushToAllSubscriptions({
          title: `${ep.seriesName} — new episode today`,
          body: `S${ep.season}E${ep.episode} "${ep.episodeName}" airs today`,
          url: "/calendar",
        }, profileId);
      } catch (error) {
        log.error({ error, seriesImdbId: ep.seriesImdbId, profileId }, "Failed to send episode push notification");
        // Don't mark as notified, so the next scheduled run retries delivery.
        continue;
      }

      try {
        // Unique constraint on (profileId, seriesImdbId, season, episode) makes
        // this an atomic claim: if the row already exists, this episode was
        // already notified for this profile and we skip recording it again.
        await prisma.notifiedEpisode.create({
          data: { profileId, seriesImdbId: ep.seriesImdbId, season: ep.season, episode: ep.episode },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }
  }
};
