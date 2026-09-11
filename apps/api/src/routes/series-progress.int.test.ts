import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { buildIntApp, createProfile } from "../lib/test-fixtures/int-db.js";
import { at } from "../lib/test-fixtures/present.js";

// Rewinding progress when an episode is un-watched is a read-then-write inside a
// transaction: delete the event, find whatever is now the latest episode event
// for that series, and either move progress back to it or delete progress
// entirely. Against a mocked client the assertion is "the code called
// findFirst with orderBy watchedAt desc" — which is the shape of the query, not
// the answer. What matters is which row Postgres actually returns, and whether
// progress ends up where the remaining history says it should.

let profileId = "";

// The real module is kept: `lib/watchlist.ts` and others import
// `getDefaultProfileId` from it, and replacing the module wholesale would take
// those exports with it.
vi.mock("../lib/profile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/profile.js")>()),
  resolveProfile: async (request: { profileId?: string }) => {
    request.profileId = profileId;
  },
}));

const SOPRANOS = "tt0141842";

let seriesApp: FastifyInstance;
let watchApp: FastifyInstance;

beforeAll(async () => {
  seriesApp = await buildIntApp((await import("./series.js")).default);
  watchApp = await buildIntApp((await import("./watch.js")).default);
});

/** Three episodes watched in order, with progress sitting on the last of them. */
const seedThreeEpisodes = async () => {
  const profile = await createProfile();
  profileId = profile.id;

  const watched = [
    { season: 2, episode: 5, at: "2026-05-01T20:00:00Z" },
    { season: 2, episode: 6, at: "2026-05-02T20:00:00Z" },
    { season: 2, episode: 7, at: "2026-05-03T20:00:00Z" },
  ];

  const events = [];
  for (const { season, episode, at } of watched) {
    events.push(
      await prisma.watchEvent.create({
        data: {
          profileId,
          type: "episode",
          imdbId: SOPRANOS,
          seriesImdbId: SOPRANOS,
          season,
          episode,
          watchedAt: new Date(at),
        },
      })
    );
  }

  await prisma.seriesProgress.create({
    data: {
      profileId,
      seriesImdbId: SOPRANOS,
      lastSeason: 2,
      lastEpisode: 7,
      lastWatchedAt: new Date("2026-05-03T20:00:00Z"),
      updatedAt: new Date("2026-05-03T20:00:00Z"),
    },
  });

  return { profile, events };
};

const progress = () =>
  prisma.seriesProgress.findUnique({
    where: { profileId_seriesImdbId: { profileId, seriesImdbId: SOPRANOS } },
  });

describe("DELETE /series/:imdbId/season/:s/episode/:e/watch", () => {
  it("rewinds progress to the next-latest episode", async () => {
    await seedThreeEpisodes();

    const response = await seriesApp.inject({
      method: "DELETE",
      url: `/series/${SOPRANOS}/season/2/episode/7/watch`,
    });

    expect(response.statusCode).toBe(204);
    expect(await progress()).toMatchObject({ lastSeason: 2, lastEpisode: 6 });
    expect(await prisma.watchEvent.count({ where: { profileId } })).toBe(2);
  });

  it("rewinds by watch time, not by episode number", async () => {
    // Watched out of order — the newest event is S2E5. Ordering by season and
    // episode would answer S2E6 here, which is not where the viewer is.
    const { profile } = await seedThreeEpisodes();
    await prisma.watchEvent.updateMany({
      where: { profileId: profile.id, season: 2, episode: 5 },
      data: { watchedAt: new Date("2026-05-04T20:00:00Z") },
    });

    await seriesApp.inject({ method: "DELETE", url: `/series/${SOPRANOS}/season/2/episode/7/watch` });

    expect(await progress()).toMatchObject({ lastSeason: 2, lastEpisode: 5 });
  });

  it("clears progress entirely when the last episode goes", async () => {
    const profile = await createProfile();
    profileId = profile.id;

    await prisma.watchEvent.create({
      data: {
        profileId,
        type: "episode",
        imdbId: SOPRANOS,
        seriesImdbId: SOPRANOS,
        season: 1,
        episode: 1,
        watchedAt: new Date("2026-05-01T20:00:00Z"),
      },
    });
    await prisma.seriesProgress.create({
      data: {
        profileId,
        seriesImdbId: SOPRANOS,
        lastSeason: 1,
        lastEpisode: 1,
        lastWatchedAt: new Date("2026-05-01T20:00:00Z"),
        updatedAt: new Date("2026-05-01T20:00:00Z"),
      },
    });

    await seriesApp.inject({ method: "DELETE", url: `/series/${SOPRANOS}/season/1/episode/1/watch` });

    expect(await progress()).toBeNull();
  });

  it("leaves another profile's progress on the same series alone", async () => {
    const { profile: ada } = await seedThreeEpisodes();
    const bob = await createProfile("Bob");
    await prisma.seriesProgress.create({
      data: {
        profileId: bob.id,
        seriesImdbId: SOPRANOS,
        lastSeason: 4,
        lastEpisode: 1,
        lastWatchedAt: new Date("2026-05-03T20:00:00Z"),
        updatedAt: new Date("2026-05-03T20:00:00Z"),
      },
    });

    profileId = ada.id;
    await seriesApp.inject({ method: "DELETE", url: `/series/${SOPRANOS}/season/2/episode/7/watch` });

    const bobProgress = await prisma.seriesProgress.findUnique({
      where: { profileId_seriesImdbId: { profileId: bob.id, seriesImdbId: SOPRANOS } },
    });
    expect(bobProgress).toMatchObject({ lastSeason: 4, lastEpisode: 1 });
  });
});

describe("DELETE /watch/:eventId", () => {
  it("rewinds progress to the next-latest episode", async () => {
    const { events } = await seedThreeEpisodes();
    const latest = at(events, 2, "seeded episode");

    const response = await watchApp.inject({ method: "DELETE", url: `/watch/${latest.id}` });

    expect(response.statusCode).toBe(204);
    expect(await progress()).toMatchObject({ lastSeason: 2, lastEpisode: 6 });
  });

  it("leaves progress where it is when an older event goes", async () => {
    const { events } = await seedThreeEpisodes();
    const middle = at(events, 1, "seeded episode");

    await watchApp.inject({ method: "DELETE", url: `/watch/${middle.id}` });

    expect(await progress()).toMatchObject({ lastSeason: 2, lastEpisode: 7 });
  });

  it("clears progress when the last remaining episode event goes", async () => {
    const { events } = await seedThreeEpisodes();

    for (const event of events) {
      await watchApp.inject({ method: "DELETE", url: `/watch/${event.id}` });
    }

    expect(await progress()).toBeNull();
    expect(await prisma.watchEvent.count({ where: { profileId } })).toBe(0);
  });

  it("refuses to delete another profile's event", async () => {
    const { events } = await seedThreeEpisodes();
    const bob = await createProfile("Bob");

    profileId = bob.id;
    const response = await watchApp.inject({ method: "DELETE", url: `/watch/${at(events, 2, "seeded episode").id}` });

    expect(response.statusCode).toBe(404);
    expect(await prisma.watchEvent.count()).toBe(3);
  });
});
