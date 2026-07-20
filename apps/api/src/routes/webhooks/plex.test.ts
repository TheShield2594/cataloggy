import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const webhookAuthMock = { verifyWebhookSecret: vi.fn(() => true) };
vi.mock("../../lib/webhook-auth.js", () => webhookAuthMock);

const watchEventMock = { recordWatchEvent: vi.fn() };
vi.mock("../../lib/watch-event.js", () => watchEventMock);

const buildApp = async (): Promise<FastifyInstance> => {
  vi.resetModules();
  const { default: plexWebhookRoutes } = await import("./plex.js");
  const app = Fastify();
  await app.register(plexWebhookRoutes);
  await app.ready();
  return app;
};

const buildMultipartBody = (payload: unknown, boundary = "boundary123") =>
  [
    `--${boundary}`,
    'Content-Disposition: form-data; name="payload"',
    "",
    JSON.stringify(payload),
    `--${boundary}--`,
  ].join("\r\n");

describe("POST /webhooks/plex", () => {
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
      url: "/webhooks/plex",
      headers: { "content-type": `multipart/form-data; boundary=b` },
      payload: buildMultipartBody({ event: "media.scrobble" }, "b"),
    });

    expect(response.statusCode).toBe(403);
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("400s when no payload field is found in a multipart body", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: `--b\r\nContent-Disposition: form-data; name="other"\r\n\r\nnope\r\n--b--`,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("400s on malformed JSON inside the payload field", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: `--b\r\nContent-Disposition: form-data; name="payload"\r\n\r\n{not json}\r\n--b--`,
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("ignores non-scrobble events without recording a watch event", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: buildMultipartBody({ event: "media.play" }, "b"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ignored", event: "media.play" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("skips scrobble events with no resolvable IMDb ID", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: buildMultipartBody({ event: "media.scrobble", Metadata: { type: "movie" } }, "b"),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "skipped", reason: "no_imdb_id" });
    expect(watchEventMock.recordWatchEvent).not.toHaveBeenCalled();
    await app.close();
  });

  it("records a movie watch event, extracting the IMDb id from the Guid array", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: buildMultipartBody(
        {
          event: "media.scrobble",
          Metadata: { type: "movie", Guid: [{ id: "tvdb://123" }, { id: "imdb://tt9999999" }] },
        },
        "b"
      ),
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "movie", imdbId: "tt9999999", source: "Plex" })
    );
    await app.close();
  });

  it("records an episode watch event with season/episode from the legacy guid field", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      payload: buildMultipartBody(
        {
          event: "media.scrobble",
          Metadata: { type: "episode", guid: "imdb://tt1234567", parentIndex: 2, index: 5 },
        },
        "b"
      ),
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "episode",
        imdbId: "tt1234567",
        seriesImdbId: "tt1234567",
        season: 2,
        episode: 5,
        source: "Plex",
      })
    );
    await app.close();
  });

  it("accepts a plain JSON body (no multipart wrapper)", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/plex",
      payload: { event: "media.scrobble", Metadata: { type: "movie", guid: "imdb://tt5555555" } },
    });

    expect(response.statusCode).toBe(201);
    expect(watchEventMock.recordWatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ imdbId: "tt5555555" })
    );
    await app.close();
  });
});
