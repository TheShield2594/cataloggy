import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelTarget, NotificationEvent } from "./notification-channels.js";

const resolveNotificationUrl = vi.fn();
vi.mock("./ssrf.js", () => ({ resolveNotificationUrl: (...args: unknown[]) => resolveNotificationUrl(...args) }));
vi.mock("./prisma.js", () => ({ prisma: { notificationChannel: { findMany: vi.fn() } } }));

const EVENT: NotificationEvent = {
  event: "upcoming-episode",
  title: "Severance — new episode today",
  body: 'S2E4 "Woe\'s Hollow" airs today',
  path: "/calendar",
  data: { seriesImdbId: "tt11280740", season: 2, episode: 4 },
};

const channel = (over: Partial<ChannelTarget>): ChannelTarget => ({
  id: "channel-1",
  kind: "ntfy",
  name: "Phone",
  url: "https://ntfy.sh/cataloggy",
  token: null,
  ...over,
});

// The module reads CATALOGGY_WEB_PUBLIC once at import, so each test imports it
// fresh with the environment it wants.
const loadModule = async (webPublic?: string) => {
  vi.resetModules();
  if (webPublic === undefined) delete process.env.CATALOGGY_WEB_PUBLIC;
  else process.env.CATALOGGY_WEB_PUBLIC = webPublic;
  return import("./notification-channels.js");
};

const bodyOf = (init: RequestInit) => JSON.parse(init.body as string);
const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

describe("buildChannelRequest", () => {
  afterEach(() => {
    delete process.env.CATALOGGY_WEB_PUBLIC;
  });

  it("posts the message as the body for ntfy, with the title in a header", async () => {
    const { buildChannelRequest } = await loadModule("https://cataloggy.example");

    const { url, init } = buildChannelRequest(channel({ kind: "ntfy" }), { ...EVENT, title: "Severance today" });

    expect(url).toBe("https://ntfy.sh/cataloggy");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(EVENT.body);
    expect(headersOf(init).Title).toBe("Severance today");
    expect(headersOf(init).Click).toBe("https://cataloggy.example/calendar");
    expect(headersOf(init).Authorization).toBeUndefined();
  });

  it("sends an ntfy access token as a bearer token", async () => {
    const { buildChannelRequest } = await loadModule();

    const { init } = buildChannelRequest(channel({ kind: "ntfy", token: "tk_secret" }), EVENT);

    expect(headersOf(init).Authorization).toBe("Bearer tk_secret");
  });

  it("RFC 2047-encodes a title that isn't plain ASCII", async () => {
    const { buildChannelRequest, encodeHeaderValue } = await loadModule();

    // undici rejects a non-latin1 header value outright, so an unencoded
    // "Pokémon" would throw before the request left the process.
    const { init } = buildChannelRequest(channel({ kind: "ntfy" }), { ...EVENT, title: "Pokémon — new episode" });

    expect(headersOf(init).Title).toBe(encodeHeaderValue("Pokémon — new episode"));
    expect(headersOf(init).Title).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(headersOf(init).Title).toMatch(/^[\x20-\x7e]*$/);
  });

  it("appends /message to a Gotify base URL and carries the token in a header", async () => {
    const { buildChannelRequest } = await loadModule("https://cataloggy.example");

    const { url, init } = buildChannelRequest(
      channel({ kind: "gotify", url: "http://192.168.1.25:8080/", token: "app-token" }),
      EVENT
    );

    expect(url).toBe("http://192.168.1.25:8080/message");
    expect(headersOf(init)["X-Gotify-Key"]).toBe("app-token");
    expect(bodyOf(init)).toMatchObject({
      title: EVENT.title,
      message: EVENT.body,
      extras: { "client::notification": { click: { url: "https://cataloggy.example/calendar" } } },
    });
  });

  it("doesn't append /message twice when the saved URL already has it", async () => {
    const { buildChannelRequest } = await loadModule();

    const { url } = buildChannelRequest(
      channel({ kind: "gotify", url: "http://gotify.lan/message", token: "t" }),
      EVENT
    );

    expect(url).toBe("http://gotify.lan/message");
  });

  it("keeps a Gotify reverse-proxy path prefix rather than rebuilding from the origin", async () => {
    const { buildChannelRequest } = await loadModule();

    const { url } = buildChannelRequest(
      channel({ kind: "gotify", url: "https://home.example/gotify", token: "t" }),
      EVENT
    );

    expect(url).toBe("https://home.example/gotify/message");
  });

  it("sends a Discord embed", async () => {
    const { buildChannelRequest } = await loadModule("https://cataloggy.example");

    const { url, init } = buildChannelRequest(
      channel({ kind: "discord", url: "https://discord.com/api/webhooks/1/abc" }),
      EVENT
    );

    expect(url).toBe("https://discord.com/api/webhooks/1/abc");
    expect(bodyOf(init).embeds[0]).toMatchObject({
      title: EVENT.title,
      description: EVENT.body,
      url: "https://cataloggy.example/calendar",
    });
  });

  it("omits the link everywhere when the deployment hasn't been told its web URL", async () => {
    const { buildChannelRequest } = await loadModule();

    // Discord rejects an embed with a relative url, and a bare "/calendar"
    // would resolve against ntfy.sh rather than this install.
    expect(bodyOf(buildChannelRequest(channel({ kind: "discord" }), EVENT).init).embeds[0].url).toBeUndefined();
    expect(headersOf(buildChannelRequest(channel({ kind: "ntfy" }), EVENT).init).Click).toBeUndefined();
    expect(bodyOf(buildChannelRequest(channel({ kind: "gotify", token: "t" }), EVENT).init).extras).toBeUndefined();
  });

  it("gives a generic webhook the structured event, not just the text", async () => {
    const { buildChannelRequest } = await loadModule("https://cataloggy.example");

    const { init } = buildChannelRequest(
      channel({ kind: "webhook", url: "https://home.example/api/webhook/x", token: "secret" }),
      EVENT
    );

    expect(headersOf(init).Authorization).toBe("Bearer secret");
    expect(bodyOf(init)).toEqual({
      event: "upcoming-episode",
      title: EVENT.title,
      message: EVENT.body,
      url: "https://cataloggy.example/calendar",
      data: EVENT.data,
    });
  });
});

describe("sendToChannel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resolveNotificationUrl.mockResolvedValue(new URL("https://ntfy.sh/cataloggy"));
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CATALOGGY_WEB_PUBLIC;
  });

  it("refuses to follow redirects, so an allowed host can't bounce the request inward", async () => {
    const { sendToChannel } = await loadModule();

    await sendToChannel(channel({}), EVENT);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ntfy.sh/cataloggy",
      expect.objectContaining({ redirect: "error", method: "POST" })
    );
  });

  it("re-resolves the URL before every send and refuses one that now points inward", async () => {
    const { sendToChannel } = await loadModule();
    resolveNotificationUrl.mockResolvedValue(null);

    await expect(sendToChannel(channel({}), EVENT)).rejects.toThrow(/not an allowed outbound target/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves the URL actually being fetched, not the one that was saved", async () => {
    const { sendToChannel } = await loadModule();

    await sendToChannel(channel({ kind: "gotify", url: "http://gotify.lan", token: "t" }), EVENT);

    expect(resolveNotificationUrl).toHaveBeenCalledWith("http://gotify.lan/message");
  });

  it("reports a non-2xx by status without echoing the response body", async () => {
    const { sendToChannel } = await loadModule();
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "internal secret" });

    // Reflecting the upstream body would make a notification channel a readable
    // SSRF probe.
    await expect(sendToChannel(channel({ name: "Phone" }), EVENT)).rejects.toThrow("Phone: HTTP 403");
  });

  describe("with an encrypted token", () => {
    const originalToken = process.env.API_TOKEN;

    afterEach(() => {
      if (originalToken === undefined) delete process.env.API_TOKEN;
      else process.env.API_TOKEN = originalToken;
    });

    it("sends the decrypted token, not what the column holds", async () => {
      process.env.API_TOKEN = "channel-token-key";
      const { sendToChannel } = await loadModule();
      const { SECRET_CONTEXT, encryptSecret } = await import("./secret-box.js");
      const stored = encryptSecret(SECRET_CONTEXT.notificationChannelToken, "gotify-app-token");
      resolveNotificationUrl.mockResolvedValue(new URL("http://gotify.lan/message"));

      await sendToChannel(channel({ kind: "gotify", url: "http://gotify.lan", token: stored }), EVENT);

      expect(headersOf(fetchMock.mock.calls[0][1])["X-Gotify-Key"]).toBe("gotify-app-token");
    });

    it("says why rather than sending unauthenticated when the token won't decrypt", async () => {
      process.env.API_TOKEN = "channel-token-key";
      const { sendToChannel } = await loadModule();
      const { SECRET_CONTEXT, encryptSecret } = await import("./secret-box.js");
      const stored = encryptSecret(SECRET_CONTEXT.notificationChannelToken, "gotify-app-token");
      process.env.API_TOKEN = "rotated-key";

      await expect(
        sendToChannel(channel({ kind: "gotify", name: "Gotify", url: "http://gotify.lan", token: stored }), EVENT)
      ).rejects.toThrow(/Gotify: stored token could not be decrypted/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
