import { describe, expect, it } from "vitest";
import { prisma } from "./prisma.js";
import { createProfile, silentLogger } from "./test-fixtures/int-db.js";
import { importPlaybackProgress, savePlaybackProgress, type PlaybackImportRow } from "./playback.js";
import { recordWatchEvent } from "./watch-event.js";

// The resume-point lifecycle against the real `PlaybackProgress_profileId_key_key`
// unique index: one row per title that a later save moves rather than adds to,
// and that a watch of the title removes — but only a watch at least as recent as
// the pause.

const SHAWSHANK = "tt0111161";
const SOPRANOS = "tt0141842";

const recordMovie = (profileId: string, watchedAt: Date) =>
  recordWatchEvent({ type: "movie", imdbId: SHAWSHANK, watchedAt, source: "test", profileId, log: silentLogger });

describe("playback progress", () => {
  it("keeps one row per title, moved by every save", async () => {
    const { id: profileId } = await createProfile("Ada");

    await savePlaybackProgress(profileId, { type: "movie", imdbId: SHAWSHANK }, { progress: 10 });
    await savePlaybackProgress(
      profileId,
      { type: "movie", imdbId: SHAWSHANK },
      { positionSeconds: 4_260, durationSeconds: 8_520 }
    );

    const rows = await prisma.playbackProgress.findMany({ where: { profileId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ progress: 50, positionSeconds: 4_260, durationSeconds: 8_520 });
  });

  it("keeps the stored seconds when a later save reports none", async () => {
    const { id: profileId } = await createProfile("Ada");
    const target = { type: "movie", imdbId: SHAWSHANK } as const;

    await savePlaybackProgress(profileId, target, { positionSeconds: 1_800, durationSeconds: 7_200 });
    await savePlaybackProgress(profileId, target, { progress: 25 });

    const row = await prisma.playbackProgress.findFirstOrThrow({ where: { profileId } });
    expect(row).toMatchObject({ progress: 25, positionSeconds: 1_800, durationSeconds: 7_200 });
  });

  it("lands an episode on the same row whichever id the player sent", async () => {
    const { id: profileId } = await createProfile("Ada");

    await savePlaybackProgress(
      profileId,
      { type: "episode", imdbId: "tt0705260", seriesImdbId: SOPRANOS, season: 2, episode: 7 },
      { progress: 20 }
    );
    await savePlaybackProgress(profileId, { type: "episode", imdbId: SOPRANOS, season: 2, episode: 7 }, { progress: 30 });

    expect(await prisma.playbackProgress.count({ where: { profileId } })).toBe(1);
  });

  it("is cleared by recording a watch of the title", async () => {
    const { id: profileId } = await createProfile("Ada");
    await savePlaybackProgress(profileId, { type: "movie", imdbId: SHAWSHANK }, { progress: 40 });

    await recordMovie(profileId, new Date());

    expect(await prisma.playbackProgress.count({ where: { profileId } })).toBe(0);
  });

  it("survives a backdated watch — an import says nothing about tonight's pause", async () => {
    const { id: profileId } = await createProfile("Ada");
    await savePlaybackProgress(profileId, { type: "movie", imdbId: SHAWSHANK }, { progress: 40 });

    await recordMovie(profileId, new Date("2024-01-01T20:00:00Z"));

    expect(await prisma.playbackProgress.count({ where: { profileId } })).toBe(1);
  });

  it("is never another profile's", async () => {
    const ada = await createProfile("Ada");
    const bob = await createProfile("Bob");
    await savePlaybackProgress(ada.id, { type: "movie", imdbId: SHAWSHANK }, { progress: 40 });
    await savePlaybackProgress(bob.id, { type: "movie", imdbId: SHAWSHANK }, { progress: 70 });

    await recordMovie(ada.id, new Date());

    expect(await prisma.playbackProgress.count({ where: { profileId: ada.id } })).toBe(0);
    expect(await prisma.playbackProgress.count({ where: { profileId: bob.id } })).toBe(1);
  });
});

describe("importing resume points", () => {
  const row = (over: Partial<PlaybackImportRow> = {}): PlaybackImportRow => ({
    target: { type: "movie", imdbId: SHAWSHANK },
    progress: 40,
    positionSeconds: 3_400,
    durationSeconds: 8_520,
    pausedAt: new Date("2026-06-01T20:00:00Z"),
    ...over,
  });

  it("writes a point into an empty profile, with its pause time kept", async () => {
    const { id: profileId } = await createProfile("Ada");

    expect(await importPlaybackProgress(profileId, [row()])).toBe(1);

    const stored = await prisma.playbackProgress.findFirstOrThrow({ where: { profileId } });
    expect(stored).toMatchObject({ key: `movie:${SHAWSHANK}`, progress: 40, positionSeconds: 3_400 });
    expect(stored.pausedAt.toISOString()).toBe("2026-06-01T20:00:00.000Z");
  });

  it("does not rewind a pause that is newer than the file's", async () => {
    const { id: profileId } = await createProfile("Ada");
    await savePlaybackProgress(profileId, { type: "movie", imdbId: SHAWSHANK }, { progress: 80 }, new Date("2026-07-01T20:00:00Z"));

    expect(await importPlaybackProgress(profileId, [row()])).toBe(0);
    expect(await prisma.playbackProgress.findFirstOrThrow({ where: { profileId } })).toMatchObject({ progress: 80 });
  });

  it("moves an older pause forward to the file's", async () => {
    const { id: profileId } = await createProfile("Ada");
    await savePlaybackProgress(profileId, { type: "movie", imdbId: SHAWSHANK }, { progress: 10 }, new Date("2026-05-01T20:00:00Z"));

    expect(await importPlaybackProgress(profileId, [row()])).toBe(1);
    expect(await prisma.playbackProgress.count({ where: { profileId } })).toBe(1);
    expect(await prisma.playbackProgress.findFirstOrThrow({ where: { profileId } })).toMatchObject({ progress: 40 });
  });

  it("brings back nothing the profile has watched since the pause", async () => {
    const { id: profileId } = await createProfile("Ada");
    await recordMovie(profileId, new Date("2026-06-02T20:00:00Z"));
    await recordWatchEvent({
      type: "episode",
      imdbId: SOPRANOS,
      seriesImdbId: SOPRANOS,
      season: 2,
      episode: 7,
      watchedAt: new Date("2026-06-02T20:00:00Z"),
      source: "test",
      profileId,
      log: silentLogger,
    });

    const written = await importPlaybackProgress(profileId, [
      row(),
      row({ target: { type: "episode", imdbId: SOPRANOS, season: 2, episode: 7 } }),
      // Watched the episode before, paused on the next one after: that one stays.
      row({ target: { type: "episode", imdbId: SOPRANOS, season: 2, episode: 8 }, pausedAt: new Date("2026-06-03T20:00:00Z") }),
    ]);

    expect(written).toBe(1);
    expect(await prisma.playbackProgress.findMany({ where: { profileId }, select: { key: true } })).toEqual([
      { key: `episode:${SOPRANOS}:2:8` },
    ]);
  });

  it("keeps the newest pause when a file lists one title twice", async () => {
    const { id: profileId } = await createProfile("Ada");

    await importPlaybackProgress(profileId, [
      row({ progress: 70, pausedAt: new Date("2026-06-05T20:00:00Z") }),
      row({ progress: 20, pausedAt: new Date("2026-06-01T20:00:00Z") }),
    ]);

    expect(await prisma.playbackProgress.findMany({ where: { profileId } })).toEqual([
      expect.objectContaining({ progress: 70 }),
    ]);
  });
});
