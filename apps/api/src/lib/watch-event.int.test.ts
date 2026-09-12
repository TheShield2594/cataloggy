import { describe, expect, it } from "vitest";
import { prisma } from "./prisma.js";
import { createProfile, silentLogger } from "./test-fixtures/int-db.js";
import { recordWatchEvent } from "./watch-event.js";
import { isUniqueConstraintError } from "./prisma-tolerant.js";
import { at, first } from "./test-fixtures/present.js";

// `watchevent_dedup_key` (migration 20260814120000) is a partial unique index over
// an expression — COALESCE of two columns, two NULL-substituting COALESCEs, and a
// date cast, restricted to rows Trakt did not supply. Prisma's DSL can express
// none of that, so it is invisible to a mocked client: the four write paths agree
// with it only because these tests say they do.
//
// The rule: one row per profile, per title, per UTC day, for everything except
// Trakt history entries.

const SHAWSHANK = "tt0111161";
const SOPRANOS = "tt0141842";

const recordMovie = (profileId: string, watchedAt: Date, note?: string) =>
  recordWatchEvent({
    type: "movie",
    imdbId: SHAWSHANK,
    watchedAt,
    note,
    source: "test",
    profileId,
    log: silentLogger,
  });

const recordEpisode = (profileId: string, watchedAt: Date, season = 2, episode = 7) =>
  recordWatchEvent({
    type: "episode",
    imdbId: SOPRANOS,
    seriesImdbId: SOPRANOS,
    season,
    episode,
    watchedAt,
    source: "test",
    profileId,
    log: silentLogger,
  });

describe("recording the same movie twice in a UTC day", () => {
  it("folds into one row with the plays incremented", async () => {
    const profile = await createProfile();

    const first = await recordMovie(profile.id, new Date("2026-05-04T09:00:00Z"));
    const second = await recordMovie(profile.id, new Date("2026-05-04T21:30:00Z"));

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);

    const events = await prisma.watchEvent.findMany({ where: { profileId: profile.id } });
    expect(events).toHaveLength(1);
    const merged = at(events, 0, "watch event");
    expect(merged.plays).toBe(2);
    // The later timestamp wins, which is what "watched again today" means.
    expect(merged.watchedAt.toISOString()).toBe("2026-05-04T21:30:00.000Z");
  });

  it("keeps the two apart across a UTC day boundary", async () => {
    const profile = await createProfile();

    await recordMovie(profile.id, new Date("2026-05-04T23:59:59Z"));
    await recordMovie(profile.id, new Date("2026-05-05T00:00:01Z"));

    const events = await prisma.watchEvent.findMany({ where: { profileId: profile.id } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.plays === 1)).toBe(true);
  });

  it("keeps two profiles' plays apart", async () => {
    const ada = await createProfile("Ada");
    const bob = await createProfile("Bob");
    const watchedAt = new Date("2026-05-04T09:00:00Z");

    await recordMovie(ada.id, watchedAt);
    await recordMovie(bob.id, watchedAt);

    expect(await prisma.watchEvent.count()).toBe(2);
  });
});

describe("recording the same episode twice in a UTC day", () => {
  it("folds into one row", async () => {
    const profile = await createProfile();

    await recordEpisode(profile.id, new Date("2026-05-04T09:00:00Z"));
    await recordEpisode(profile.id, new Date("2026-05-04T10:00:00Z"));

    const events = await prisma.watchEvent.findMany({ where: { profileId: profile.id } });
    expect(events).toHaveLength(1);
    expect(first(events, "watch event").plays).toBe(2);
  });

  it("keeps different episodes of one series apart", async () => {
    const profile = await createProfile();
    const watchedAt = new Date("2026-05-04T09:00:00Z");

    await recordEpisode(profile.id, watchedAt, 2, 7);
    await recordEpisode(profile.id, watchedAt, 2, 8);

    expect(await prisma.watchEvent.count({ where: { profileId: profile.id } })).toBe(2);
  });

  it("advances series progress alongside the event", async () => {
    const profile = await createProfile();

    await recordEpisode(profile.id, new Date("2026-05-04T09:00:00Z"), 2, 7);

    const progress = await prisma.seriesProgress.findUnique({
      where: { profileId_seriesImdbId: { profileId: profile.id, seriesImdbId: SOPRANOS } },
    });
    expect(progress).toMatchObject({ lastSeason: 2, lastEpisode: 7 });
  });
});

describe("the dedup index itself", () => {
  it("refuses a second row for the same movie, profile and UTC day", async () => {
    const profile = await createProfile();
    await recordMovie(profile.id, new Date("2026-05-04T09:00:00Z"));

    // What a second concurrent writer's create reaches: the read-then-write in
    // `recordWatchEvent` cannot see an uncommitted row, so this is the collision
    // the index exists to turn into a retry rather than a duplicate.
    const duplicate = prisma.watchEvent.create({
      data: {
        type: "movie",
        imdbId: SHAWSHANK,
        watchedAt: new Date("2026-05-04T18:00:00Z"),
        profileId: profile.id,
      },
    });

    await expect(duplicate.catch(isUniqueConstraintError)).resolves.toBe(true);
  });

  it("refuses a second row for the same episode even when imdbId differs", async () => {
    // Episode rows carry the episode's own imdbId in `imdbId` on some paths and
    // the series' on others; the index keys on COALESCE(seriesImdbId, imdbId), so
    // both are the same watch.
    const profile = await createProfile();
    await recordEpisode(profile.id, new Date("2026-05-04T09:00:00Z"), 2, 7);

    const duplicate = prisma.watchEvent.create({
      data: {
        type: "episode",
        imdbId: "tt0705282",
        seriesImdbId: SOPRANOS,
        season: 2,
        episode: 7,
        watchedAt: new Date("2026-05-04T20:00:00Z"),
        profileId: profile.id,
      },
    });

    await expect(duplicate.catch(isUniqueConstraintError)).resolves.toBe(true);
  });

  it("lets two Trakt history entries for one day coexist", async () => {
    // One Trakt history entry is one play, and there is nowhere to record a
    // second entry's id — so folding them would lose a play on import or
    // double-count it on the next poll. The index is partial for this reason.
    const profile = await createProfile();
    const watchedAt = new Date("2026-05-04T09:00:00Z");

    await prisma.watchEvent.create({
      data: { type: "movie", imdbId: SHAWSHANK, watchedAt, profileId: profile.id, traktHistoryId: 1n },
    });
    await prisma.watchEvent.create({
      data: { type: "movie", imdbId: SHAWSHANK, watchedAt, profileId: profile.id, traktHistoryId: 2n },
    });

    expect(await prisma.watchEvent.count({ where: { profileId: profile.id } })).toBe(2);
  });

  it("still refuses two rows carrying the same Trakt history id", async () => {
    // What makes re-polling an overlapping window idempotent.
    const profile = await createProfile();
    const watchedAt = new Date("2026-05-04T09:00:00Z");

    await prisma.watchEvent.create({
      data: { type: "movie", imdbId: SHAWSHANK, watchedAt, profileId: profile.id, traktHistoryId: 99n },
    });

    const duplicate = prisma.watchEvent.create({
      data: {
        type: "movie",
        imdbId: SHAWSHANK,
        watchedAt: new Date("2026-06-01T09:00:00Z"),
        profileId: profile.id,
        traktHistoryId: 99n,
      },
    });

    await expect(duplicate.catch(isUniqueConstraintError)).resolves.toBe(true);
  });

  it("does not confuse a movie with an episode of the same id", async () => {
    const profile = await createProfile();
    const watchedAt = new Date("2026-05-04T09:00:00Z");

    await prisma.watchEvent.create({
      data: { type: "movie", imdbId: SOPRANOS, watchedAt, profileId: profile.id },
    });
    await prisma.watchEvent.create({
      data: {
        type: "episode",
        imdbId: SOPRANOS,
        seriesImdbId: SOPRANOS,
        season: 1,
        episode: 1,
        watchedAt,
        profileId: profile.id,
      },
    });

    expect(await prisma.watchEvent.count({ where: { profileId: profile.id } })).toBe(2);
  });
});

describe("watchedAt as an instant", () => {
  it("comes back as the moment it went in, not a wall clock", async () => {
    // The column is timestamptz; a naive one would round-trip through whatever
    // TZ the process happened to be in.
    const profile = await createProfile();
    const watchedAt = new Date("2026-05-04T09:15:30.123Z");

    await recordMovie(profile.id, watchedAt);

    const event = first(await prisma.watchEvent.findMany({ where: { profileId: profile.id } }), "watch event");
    expect(event.watchedAt.toISOString()).toBe("2026-05-04T09:15:30.123Z");
  });
});
