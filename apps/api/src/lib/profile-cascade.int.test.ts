import { describe, expect, it } from "vitest";
import { prisma } from "./prisma.js";
import { createProfile } from "./test-fixtures/int-db.js";

// Deleting a profile is meant to take everything that belonged to it: watch
// history, lists and their items, ratings, tags and their tagged items, games,
// scrobble sessions, the check-in, push subscriptions, notification channels,
// notified-episode records, play signals and series progress.
//
// All of that is `onDelete: Cascade` on a foreign key — enforced entirely by
// Postgres, so a mocked client cannot tell the difference between a schema that
// cascades and one that would raise a foreign-key violation and leave a
// half-deleted profile behind. Which is worse than it sounds: `ListItem` and
// `ItemTag` reach the profile through two hops (List, Tag), so they depend on a
// cascade of a cascade.

const SHAWSHANK = "tt0111161";
const SOPRANOS = "tt0141842";

/** A profile with one row in every table that hangs off it, directly or not. */
const seedFullProfile = async (name: string) => {
  const profile = await createProfile(name);
  const { id: profileId } = profile;

  const list = await prisma.list.create({
    data: {
      profileId,
      kind: "custom",
      name: `${name}'s list`,
      items: { create: [{ type: "movie", imdbId: SHAWSHANK }] },
    },
  });

  const tag = await prisma.tag.create({
    data: {
      profileId,
      name: `${name}-tag`,
      items: { create: [{ type: "movie", imdbId: SHAWSHANK }] },
    },
  });

  await prisma.watchEvent.create({
    data: { profileId, type: "movie", imdbId: SHAWSHANK, watchedAt: new Date("2026-05-04T09:00:00Z") },
  });
  await prisma.seriesProgress.create({
    data: {
      profileId,
      seriesImdbId: SOPRANOS,
      lastSeason: 2,
      lastEpisode: 7,
      lastWatchedAt: new Date("2026-05-04T09:00:00Z"),
      updatedAt: new Date("2026-05-04T09:00:00Z"),
    },
  });
  await prisma.rating.create({
    data: { profileId, imdbId: SHAWSHANK, type: "movie", rating: 9, ratedAt: new Date() },
  });
  await prisma.checkIn.create({
    data: { profileId, type: "movie", imdbId: SHAWSHANK, name: "Shawshank", startedAt: new Date() },
  });
  // `Game_igdbId_or_steamAppId_check` requires one of the two ids — another
  // constraint that lives only in migration SQL.
  await prisma.game.create({ data: { profileId, title: `${name}'s game`, steamAppId: 620 } });
  await prisma.scrobbleSession.create({
    data: { profileId, type: "movie", imdbId: SHAWSHANK, updatedAt: new Date() },
  });
  await prisma.pushSubscription.create({
    data: { profileId, endpoint: `https://push.example/${name}`, p256dh: "k", auth: "a" },
  });
  await prisma.notificationChannel.create({
    data: { profileId, kind: "ntfy", name: `${name}-ntfy`, url: "https://ntfy.example/topic" },
  });
  await prisma.notifiedEpisode.create({
    data: { profileId, seriesImdbId: SOPRANOS, season: 2, episode: 8 },
  });
  await prisma.playSignal.create({
    data: {
      profileId,
      key: `movie:${SHAWSHANK}`,
      type: "movie",
      imdbId: SHAWSHANK,
      resource: "stream",
      lastSeenAt: new Date(),
      dueAt: new Date(),
    },
  });

  return { profile, listId: list.id, tagId: tag.id };
};

/** Every table that should be empty of this profile's rows afterwards. */
const countsFor = async (profileId: string, listId: string, tagId: string) => ({
  lists: await prisma.list.count({ where: { profileId } }),
  listItems: await prisma.listItem.count({ where: { listId } }),
  tags: await prisma.tag.count({ where: { profileId } }),
  itemTags: await prisma.itemTag.count({ where: { tagId } }),
  watchEvents: await prisma.watchEvent.count({ where: { profileId } }),
  seriesProgress: await prisma.seriesProgress.count({ where: { profileId } }),
  ratings: await prisma.rating.count({ where: { profileId } }),
  checkIns: await prisma.checkIn.count({ where: { profileId } }),
  games: await prisma.game.count({ where: { profileId } }),
  scrobbleSessions: await prisma.scrobbleSession.count({ where: { profileId } }),
  pushSubscriptions: await prisma.pushSubscription.count({ where: { profileId } }),
  notificationChannels: await prisma.notificationChannel.count({ where: { profileId } }),
  notifiedEpisodes: await prisma.notifiedEpisode.count({ where: { profileId } }),
  playSignals: await prisma.playSignal.count({ where: { profileId } }),
});

describe("deleting a profile", () => {
  it("takes every row that belonged to it, including two hops down", async () => {
    const { profile, listId, tagId } = await seedFullProfile("Ada");

    const before = await countsFor(profile.id, listId, tagId);
    expect(Object.values(before).every((count) => count === 1)).toBe(true);

    await prisma.profile.delete({ where: { id: profile.id } });

    const after = await countsFor(profile.id, listId, tagId);
    expect(after).toEqual({
      lists: 0,
      listItems: 0,
      tags: 0,
      itemTags: 0,
      watchEvents: 0,
      seriesProgress: 0,
      ratings: 0,
      checkIns: 0,
      games: 0,
      scrobbleSessions: 0,
      pushSubscriptions: 0,
      notificationChannels: 0,
      notifiedEpisodes: 0,
      playSignals: 0,
    });
  });

  it("leaves another profile's rows alone", async () => {
    const ada = await seedFullProfile("Ada");
    const bob = await seedFullProfile("Bob");

    await prisma.profile.delete({ where: { id: ada.profile.id } });

    const remaining = await countsFor(bob.profile.id, bob.listId, bob.tagId);
    expect(Object.values(remaining).every((count) => count === 1)).toBe(true);
  });

  it("leaves the shared catalog alone — Item and Metadata are nobody's", async () => {
    // These two tables are keyed by title, not by profile, and are deliberately
    // outside the cascade: deleting a profile must not evict the artwork and
    // titles the remaining profiles are still reading.
    const { profile } = await seedFullProfile("Ada");
    await prisma.item.create({ data: { type: "movie", imdbId: SHAWSHANK } });
    await prisma.metadata.create({
      data: { imdbId: SHAWSHANK, type: "movie", name: "The Shawshank Redemption" },
    });

    await prisma.profile.delete({ where: { id: profile.id } });

    expect(await prisma.item.count()).toBe(1);
    expect(await prisma.metadata.count()).toBe(1);
  });
});
