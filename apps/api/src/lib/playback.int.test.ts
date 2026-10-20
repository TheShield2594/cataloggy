import { describe, expect, it } from "vitest";
import { prisma } from "./prisma.js";
import { createProfile, silentLogger } from "./test-fixtures/int-db.js";
import { savePlaybackProgress } from "./playback.js";
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
