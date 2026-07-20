import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const webhookAuthMock = { verifyWebhookSecret: vi.fn(() => true) };
vi.mock("../../lib/webhook-auth.js", () => webhookAuthMock);

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("../../lib/watch-event.js", () => watchEventMock);

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: jellyfinWebhookRoutes } = await import("./jellyfin.js");
  const app = Fastify();
  await app.register(jellyfinWebhookRoutes);
  await app.ready();
  return app;
};

describe("POST /webhooks/jellyfin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookAuthMock.verifyWebhookSecret.mockReturnValue(true);
    watchEventMock.recordWatchEvent.mockResolvedValue({ watchEvent: { id: "we-1" }, wasCreated: true });
  });

  it("rejects requests that fail webhook secret verification", async () => {
    webhookAuthMock.verifyWebhookSecret.mockReturnValue(false);
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: { NotificationType: "PlaybackStop" },
    });

    expect(response.statusCode).toBe(403);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("400s with the route's own error when the parsed body is null", async () => {
    const app = await buildApp();

    // A genuinely empty request body never reaches the route handler — Fastify's
    // JSON parser itself rejects it before the handler's `if (!body)` check runs.
    // A literal JSON `null` body does reach the handler, so this exercises that
    // check specifically instead of just asserting "some 400 happened".
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: "null",
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Empty body" });
    await app.close();
  });

  it("ignores notification types other than PlaybackStop", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: { NotificationType: "PlaybackStart" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored", type: "PlaybackStart" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips PlaybackStop events with no IMDb provider id", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: { NotificationType: "PlaybackStop", ItemType: "Movie" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "skipped", reason: "no_imdb_id" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("records a movie watch event", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: { NotificationType: "PlaybackStop", ItemType: "Movie", Provider_imdb: "tt1111111" },
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "movie", imdbId: "tt1111111", source: "Jellyfin" })
    );
    await app.close();
  });

  it("records an episode watch event with season/episode", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/jellyfin",
      payload: {
        NotificationType: "PlaybackStop",
        ItemType: "Episode",
        Provider_imdb: "tt2222222",
        Season: 3,
        Episode: 7,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "episode",
        imdbId: "tt2222222",
        seriesImdbId: "tt2222222",
        season: 3,
        episode: 7,
        source: "Jellyfin",
      })
    );
    await app.close();
  });
});
