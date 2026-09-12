import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildRouteApp } from "../../lib/test-fixtures/route-app.js";

const webhookAuthMock = { verifyWebhookSecret: vi.fn(() => true) };
vi.mock("../../lib/webhook-auth.js", () => webhookAuthMock);

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("../../lib/watch-event.js", () => watchEventMock);

const webhookProfileMock = { resolveWebhookProfile: vi.fn() };
vi.mock("../../lib/webhook-profile.js", () => webhookProfileMock);

const buildApp = (): Promise<FastifyInstance> => buildRouteApp(() => import("./emby.js"));

const movieStop = {
  Event: "playback.stop",
  Item: { Type: "Movie", Name: "Arrival", ProviderIds: { Imdb: "tt2543164", Tmdb: "329865" } },
  User: { Name: "Sam" },
};

describe("POST /webhooks/emby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookAuthMock.verifyWebhookSecret.mockReturnValue(true);
    watchEventMock.recordWatchEvent.mockResolvedValue({ watchEvent: { id: "we-1" }, wasCreated: true });
    webhookProfileMock.resolveWebhookProfile.mockResolvedValue({ ok: true, profileId: "profile-1" });
  });

  it("rejects requests that fail webhook secret verification", async () => {
    webhookAuthMock.verifyWebhookSecret.mockReturnValue(false);
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/webhooks/emby", payload: movieStop });

    expect(response.statusCode).toBe(403);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("400s with the route's own error when the parsed body is null", async () => {
    const app = await buildApp();

    // A genuinely empty body is refused by Fastify's JSON parser before the
    // handler runs; a literal JSON `null` reaches the handler, so this is what
    // exercises its own `if (!body)` check.
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: "null",
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Empty body" });
  });

  it("ignores events other than playback stop", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { ...movieStop, Event: "playback.start" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored", event: "playback.start" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("accepts a reshaped template that spells the event Jellyfin's way", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { ...movieStop, Event: "PlaybackStop" },
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "movie", imdbId: "tt2543164" })
    );
  });

  it("400s when a playback stop carries no Item", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "No Item in payload" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("skips item types Cataloggy does not store rather than filing them as films", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop", Item: { Type: "Audio", Name: "Neon Bible", ProviderIds: {} } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "skipped", reason: "unsupported_item_type" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("skips items Emby holds no IMDb id for", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop", Item: { Type: "Movie", ProviderIds: { Tvdb: "12345" } } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "skipped", reason: "no_imdb_id" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });

  it("skips an id that is present but not an IMDb id", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop", Item: { Type: "Movie", ProviderIds: { Imdb: "329865" } } },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "skipped", reason: "no_imdb_id" });
  });

  it("records a movie watch event", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/webhooks/emby", payload: movieStop });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "movie", imdbId: "tt2543164", source: "Emby", profileId: "profile-1" })
    );
  });

  it("reads the provider id whatever case the scraper spelt the key in", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop", Item: { Type: "Movie", ProviderIds: { IMDB: "tt0110912" } } },
    });

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ imdbId: "tt0110912" })
    );
  });

  it("records an episode with its season and episode numbers", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: {
        Event: "playback.stop",
        Item: {
          Type: "Episode",
          Name: "Ozymandias",
          SeriesName: "Breaking Bad",
          ParentIndexNumber: 5,
          IndexNumber: 14,
          ProviderIds: { Imdb: "tt0903747" },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "episode",
        imdbId: "tt0903747",
        seriesImdbId: "tt0903747",
        season: 5,
        episode: 14,
        source: "Emby",
      })
    );
  });

  it("prefers the series' own id over the episode's when Emby sends both", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: {
        Event: "playback.stop",
        Item: {
          Type: "Episode",
          ParentIndexNumber: 1,
          IndexNumber: 2,
          ProviderIds: { Imdb: "tt2301451" },
          SeriesProviderIds: { Imdb: "tt0903747" },
        },
      },
    });

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ seriesImdbId: "tt0903747", imdbId: "tt0903747" })
    );
  });

  it("records a null season and episode when the payload omits the numbers", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { Event: "playback.stop", Item: { Type: "Episode", ProviderIds: { Imdb: "tt0903747" } } },
    });

    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ season: null, episode: null })
    );
  });

  it("records against the profile resolved from the Emby username", async () => {
    webhookProfileMock.resolveWebhookProfile.mockResolvedValue({ ok: true, profileId: "profile-sam" });
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/webhooks/emby", payload: movieStop });

    expect(response.statusCode).toBe(201);
    expect(webhookProfileMock.resolveWebhookProfile).toHaveBeenCalledWith(expect.anything(), "Sam");
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: "profile-sam" })
    );
  });

  it("falls back to a flat Username when User.Name renders empty", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/webhooks/emby",
      payload: { ...movieStop, User: { Name: "   " }, Username: "Alex" },
    });

    expect(webhookProfileMock.resolveWebhookProfile).toHaveBeenCalledWith(expect.anything(), "Alex");
  });

  it("does not record anything when the profile can't be resolved", async () => {
    webhookProfileMock.resolveWebhookProfile.mockResolvedValue({
      ok: false,
      status: 400,
      error: "The profile query parameter must be a valid UUID",
    });
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/emby?profile=not-a-uuid",
      payload: movieStop,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "The profile query parameter must be a valid UUID" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
  });
});
