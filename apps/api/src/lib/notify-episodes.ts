import type { FastifyBaseLogger } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getUpcomingEpisodes } from "./upcoming-episodes.js";
import { deliverNotification, getNotifiableProfileIds } from "./notify.js";

export const checkUpcomingEpisodesAndNotify = async (log: FastifyBaseLogger): Promise<void> => {
  // Notification targets are per-profile, so only profiles with at least one
  // (a push subscription or an enabled channel) need to be checked for
  // upcoming episodes.
  const profileIds = await getNotifiableProfileIds();
  if (profileIds.length === 0) return;

  // Collected rather than thrown on the spot: one dead channel must not stop
  // the remaining episodes or profiles from being notified. They are raised at
  // the end so the failure reaches Settings → Sync Status via the job runner's
  // recordJobFailure, instead of living only in the logs.
  const failures: Error[] = [];

  for (const profileId of profileIds) {
    const airingToday = await getUpcomingEpisodes(profileId, 0, null);
    if (airingToday.length === 0) continue;

    // NotifiedEpisode was previously only ever written, never read: the unique
    // constraint stopped a *second row* being recorded, but the send happened
    // before it, so an episode airing today was notified again on every run —
    // hourly by default, for as long as it stayed today's next episode. Read
    // the claims first; the P2002 catch below stays as the race guard it was.
    const claimed = await prisma.notifiedEpisode.findMany({
      where: {
        profileId,
        OR: airingToday.map((ep) => ({
          seriesImdbId: ep.seriesImdbId,
          season: ep.season,
          episode: ep.episode,
        })),
      },
      select: { seriesImdbId: true, season: true, episode: true },
    });
    const episodeKey = (ep: { seriesImdbId: string; season: number; episode: number }) =>
      `${ep.seriesImdbId}:${ep.season}:${ep.episode}`;
    const alreadyNotified = new Set(claimed.map(episodeKey));

    for (const ep of airingToday) {
      if (alreadyNotified.has(episodeKey(ep))) continue;

      const result = await deliverNotification(
        {
          event: "upcoming-episode",
          title: `${ep.seriesName} — new episode today`,
          body: `S${ep.season}E${ep.episode} "${ep.episodeName}" airs today`,
          path: "/calendar",
          data: {
            seriesImdbId: ep.seriesImdbId,
            seriesName: ep.seriesName,
            season: ep.season,
            episode: ep.episode,
            episodeName: ep.episodeName,
          },
        },
        profileId
      );

      for (const failure of result.failures) {
        log.error({ error: failure, seriesImdbId: ep.seriesImdbId, profileId }, "Episode notification failed");
        failures.push(failure);
      }

      if (result.delivered === 0) {
        // Nothing got through, so don't mark as notified — the next scheduled
        // run retries delivery.
        continue;
      }

      // A target that failed while another succeeded misses this episode: the
      // claim below is per-episode, not per-target, and tracking it per-target
      // would mean a row per channel per episode to avoid re-notifying the ones
      // that worked. The failure is logged and surfaced in Sync Status instead.
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

  if (failures.length > 0) {
    // Sync Status stores the message and nothing else, so the reasons have to
    // be in it — a bare count would say a channel broke without saying which,
    // or how. Deduplicated because one dead channel produces one identical
    // failure per episode.
    const reasons = [...new Set(failures.map((f) => f.message))];
    const summary = reasons.slice(0, 3).join("; ");
    throw new AggregateError(
      failures,
      `${failures.length} episode notification(s) failed to send: ${summary}` +
        (reasons.length > 3 ? ` (+${reasons.length - 3} more)` : "")
    );
  }
};
