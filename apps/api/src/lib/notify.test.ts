import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliverNotification, getNotifiableProfileIds } from "./notify.js";
import type { NotificationEvent } from "./notification-channels.js";

// Hoisted so the vi.mock factories below — which run before this file's own
// imports — can close over them.
const { prismaMock, sendPushToAllSubscriptions, listEnabledChannels, sendToChannel } = vi.hoisted(() => ({
  prismaMock: {
    pushSubscription: { count: vi.fn(), findMany: vi.fn() },
    notificationChannel: { findMany: vi.fn() },
  },
  sendPushToAllSubscriptions: vi.fn(),
  listEnabledChannels: vi.fn(),
  sendToChannel: vi.fn(),
}));

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./push.js", () => ({
  sendPushToAllSubscriptions: (...args: unknown[]) => sendPushToAllSubscriptions(...args),
}));
vi.mock("./notification-channels.js", () => ({
  listEnabledChannels: (...args: unknown[]) => listEnabledChannels(...args),
  sendToChannel: (...args: unknown[]) => sendToChannel(...args),
}));

const PROFILE = "profile-1";
const EVENT: NotificationEvent = {
  event: "upcoming-episode",
  title: "Severance — new episode today",
  body: "S2E4 airs today",
  path: "/calendar",
};

const channel = (id: string, kind = "ntfy") => ({ id, kind, name: id, url: `https://ntfy.sh/${id}`, token: null });

describe("getNotifiableProfileIds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unions push subscribers with channel owners, without repeating a profile that has both", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([{ profileId: "a" }, { profileId: "b" }]);
    prismaMock.notificationChannel.findMany.mockResolvedValue([{ profileId: "b" }, { profileId: "c" }]);

    expect(await getNotifiableProfileIds()).toEqual(["a", "b", "c"]);
  });

  it("only counts enabled channels", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([]);
    prismaMock.notificationChannel.findMany.mockResolvedValue([]);

    await getNotifiableProfileIds();

    expect(prismaMock.notificationChannel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } })
    );
  });
});

describe("deliverNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pushSubscription.count.mockResolvedValue(0);
    listEnabledChannels.mockResolvedValue([]);
    sendPushToAllSubscriptions.mockResolvedValue(undefined);
    sendToChannel.mockResolvedValue(undefined);
  });

  it("sends to push and every enabled channel", async () => {
    prismaMock.pushSubscription.count.mockResolvedValue(2);
    listEnabledChannels.mockResolvedValue([channel("one"), channel("two", "discord")]);

    const result = await deliverNotification(EVENT, PROFILE);

    expect(result).toEqual({ attempted: 3, delivered: 3, failures: [] });
    expect(sendPushToAllSubscriptions).toHaveBeenCalledWith(
      { title: EVENT.title, body: EVENT.body, url: "/calendar" },
      PROFILE
    );
    expect(sendToChannel).toHaveBeenCalledTimes(2);
  });

  it("doesn't attempt push when the profile has no subscriptions", async () => {
    listEnabledChannels.mockResolvedValue([channel("one")]);

    const result = await deliverNotification(EVENT, PROFILE);

    expect(sendPushToAllSubscriptions).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 1, delivered: 1 });
  });

  it("keeps one dead channel from stopping the others, and names it in the failure", async () => {
    prismaMock.pushSubscription.count.mockResolvedValue(1);
    listEnabledChannels.mockResolvedValue([channel("one"), channel("two", "gotify")]);
    sendToChannel.mockRejectedValueOnce(new Error("one: HTTP 404")).mockResolvedValueOnce(undefined);

    const result = await deliverNotification(EVENT, PROFILE);

    expect(result.attempted).toBe(3);
    expect(result.delivered).toBe(2);
    expect(result.failures.map((f) => f.message)).toEqual(["ntfy channel: one: HTTP 404"]);
  });

  it("reports a push failure without throwing, so configured channels still count as delivered", async () => {
    prismaMock.pushSubscription.count.mockResolvedValue(1);
    listEnabledChannels.mockResolvedValue([channel("one")]);
    sendPushToAllSubscriptions.mockRejectedValue(new Error("410 Gone"));

    const result = await deliverNotification(EVENT, PROFILE);

    expect(result.delivered).toBe(1);
    expect(result.failures.map((f) => f.message)).toEqual(["web push: 410 Gone"]);
  });

  it("reports nothing delivered when a profile's only target fails", async () => {
    prismaMock.pushSubscription.count.mockResolvedValue(1);
    sendPushToAllSubscriptions.mockRejectedValue(new Error("boom"));

    expect(await deliverNotification(EVENT, PROFILE)).toMatchObject({ attempted: 1, delivered: 0 });
  });
});
