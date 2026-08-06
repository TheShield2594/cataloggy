import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { checkUpcomingEpisodesAndNotify } from "./notify-episodes.js";
import { P2002 } from "./test-fixtures/prisma-errors.js";

// Hoisted so the vi.mock factories below — which run before this file's own
// imports — can close over them.
const { prismaMock, getUpcomingEpisodes, getNotifiableProfileIds, deliverNotification } = vi.hoisted(() => ({
  prismaMock: { notifiedEpisode: { findMany: vi.fn(), create: vi.fn() } },
  getUpcomingEpisodes: vi.fn(),
  getNotifiableProfileIds: vi.fn(),
  deliverNotification: vi.fn(),
}));

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./upcoming-episodes.js", () => ({
  getUpcomingEpisodes: (...args: unknown[]) => getUpcomingEpisodes(...args),
}));
vi.mock("./notify.js", () => ({
  getNotifiableProfileIds: () => getNotifiableProfileIds(),
  deliverNotification: (...args: unknown[]) => deliverNotification(...args),
}));

const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

const episode = (over: Partial<{ seriesImdbId: string; season: number; episode: number }> = {}) => ({
  seriesImdbId: "tt11280740",
  seriesName: "Severance",
  poster: null,
  season: 2,
  episode: 4,
  episodeName: "Woe's Hollow",
  airDate: "2026-08-06",
  overview: null,
  ...over,
});

describe("checkUpcomingEpisodesAndNotify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getNotifiableProfileIds.mockResolvedValue(["profile-1"]);
    getUpcomingEpisodes.mockResolvedValue([episode()]);
    prismaMock.notifiedEpisode.findMany.mockResolvedValue([]);
    prismaMock.notifiedEpisode.create.mockResolvedValue({});
    deliverNotification.mockResolvedValue({ attempted: 1, delivered: 1, failures: [] });
  });

  it("does nothing when no profile has a way to be notified", async () => {
    getNotifiableProfileIds.mockResolvedValue([]);

    await checkUpcomingEpisodesAndNotify(log);

    expect(getUpcomingEpisodes).not.toHaveBeenCalled();
  });

  it("notifies an episode airing today and records the claim", async () => {
    await checkUpcomingEpisodesAndNotify(log);

    expect(deliverNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "upcoming-episode",
        title: "Severance — new episode today",
        path: "/calendar",
        data: expect.objectContaining({ seriesImdbId: "tt11280740", season: 2, episode: 4 }),
      }),
      "profile-1"
    );
    expect(prismaMock.notifiedEpisode.create).toHaveBeenCalledWith({
      data: { profileId: "profile-1", seriesImdbId: "tt11280740", season: 2, episode: 4 },
    });
  });

  it("skips an episode that was already notified instead of re-sending it every run", async () => {
    // The claim table used to be written and never read, so an episode airing
    // today was notified again on every check for as long as it stayed today's
    // next episode.
    prismaMock.notifiedEpisode.findMany.mockResolvedValue([
      { seriesImdbId: "tt11280740", season: 2, episode: 4 },
    ]);

    await checkUpcomingEpisodesAndNotify(log);

    expect(deliverNotification).not.toHaveBeenCalled();
    expect(prismaMock.notifiedEpisode.create).not.toHaveBeenCalled();
  });

  it("only skips the episodes actually claimed", async () => {
    getUpcomingEpisodes.mockResolvedValue([episode(), episode({ seriesImdbId: "tt0903747", season: 5, episode: 1 })]);
    prismaMock.notifiedEpisode.findMany.mockResolvedValue([
      { seriesImdbId: "tt11280740", season: 2, episode: 4 },
    ]);

    await checkUpcomingEpisodesAndNotify(log);

    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(prismaMock.notifiedEpisode.create).toHaveBeenCalledWith({
      data: { profileId: "profile-1", seriesImdbId: "tt0903747", season: 5, episode: 1 },
    });
  });

  it("leaves the episode unclaimed when nothing got through, so the next run retries", async () => {
    deliverNotification.mockResolvedValue({
      attempted: 1,
      delivered: 0,
      failures: [new Error("ntfy channel: HTTP 502")],
    });

    await expect(checkUpcomingEpisodesAndNotify(log)).rejects.toThrow(AggregateError);

    expect(prismaMock.notifiedEpisode.create).not.toHaveBeenCalled();
  });

  it("claims the episode when at least one target took it, and still reports the one that failed", async () => {
    deliverNotification.mockResolvedValue({
      attempted: 2,
      delivered: 1,
      failures: [new Error("gotify channel: HTTP 401")],
    });

    // Raised at the end rather than on the spot: the failure has to reach
    // Settings → Sync Status, but not at the cost of the remaining episodes.
    const error = await checkUpcomingEpisodesAndNotify(log).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((e: Error) => e.message)).toEqual(["gotify channel: HTTP 401"]);
    expect(prismaMock.notifiedEpisode.create).toHaveBeenCalledTimes(1);
  });

  it("names the reasons in the error, since Sync Status only keeps its message", async () => {
    getUpcomingEpisodes.mockResolvedValue([episode(), episode({ season: 2, episode: 5 })]);
    deliverNotification.mockResolvedValue({
      attempted: 1,
      delivered: 0,
      failures: [new Error("ntfy channel: Phone: HTTP 404")],
    });

    const error = (await checkUpcomingEpisodesAndNotify(log).catch((e: unknown) => e)) as Error;

    // One dead channel produces one identical failure per episode, so the
    // reasons are deduplicated rather than repeated.
    expect(error.message).toBe("2 episode notification(s) failed to send: ntfy channel: Phone: HTTP 404");
  });

  it("carries on to the next profile after one fails to deliver", async () => {
    getNotifiableProfileIds.mockResolvedValue(["profile-1", "profile-2"]);
    deliverNotification
      .mockResolvedValueOnce({ attempted: 1, delivered: 0, failures: [new Error("down")] })
      .mockResolvedValueOnce({ attempted: 1, delivered: 1, failures: [] });

    await expect(checkUpcomingEpisodesAndNotify(log)).rejects.toThrow(AggregateError);

    expect(deliverNotification).toHaveBeenCalledTimes(2);
    expect(prismaMock.notifiedEpisode.create).toHaveBeenCalledWith({
      data: { profileId: "profile-2", seriesImdbId: "tt11280740", season: 2, episode: 4 },
    });
  });

  it("treats a concurrent claim as already handled rather than an error", async () => {
    prismaMock.notifiedEpisode.create.mockRejectedValue(P2002);

    await expect(checkUpcomingEpisodesAndNotify(log)).resolves.toBeUndefined();
  });
});
