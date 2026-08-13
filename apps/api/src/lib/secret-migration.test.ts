import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { findMany: vi.fn(), update: vi.fn() },
  traktToken: { findMany: vi.fn(), update: vi.fn() },
  stremioAuth: { findMany: vi.fn(), update: vi.fn() },
  notificationChannel: { findMany: vi.fn(), update: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const { encryptStoredSecrets } = await import("./secret-migration.js");
const { SECRET_CONTEXT, decryptSecret, encryptSecret, isEncryptedSecret, kvSecretContext } =
  await import("./secret-box.js");

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const run = () => encryptStoredSecrets(logger as never);

const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_TOKEN = "migration-token";
  prismaMock.kV.findMany.mockResolvedValue([]);
  prismaMock.traktToken.findMany.mockResolvedValue([]);
  prismaMock.stremioAuth.findMany.mockResolvedValue([]);
  prismaMock.notificationChannel.findMany.mockResolvedValue([]);
  for (const model of [prismaMock.kV, prismaMock.traktToken, prismaMock.stremioAuth, prismaMock.notificationChannel]) {
    model.update.mockResolvedValue({});
  }
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.API_TOKEN;
  else process.env.API_TOKEN = originalToken;
});

describe("encryptStoredSecrets", () => {
  it("encrypts credential rows left in plaintext, in place", async () => {
    prismaMock.kV.findMany.mockResolvedValue([{ key: "tmdb:apiKey", value: "tmdb-plain" }]);
    prismaMock.traktToken.findMany.mockResolvedValue([
      { id: "default", accessToken: "access-plain", refreshToken: "refresh-plain" },
    ]);
    prismaMock.stremioAuth.findMany.mockResolvedValue([{ id: "default", authKey: "authkey-plain" }]);
    prismaMock.notificationChannel.findMany.mockResolvedValue([
      { id: "chan-1", name: "Gotify", token: "gotify-plain" },
    ]);

    const sweep = await run();

    expect(sweep).toEqual({ encrypted: 5, unreadable: [] });

    const kvWrite = prismaMock.kV.update.mock.calls[0][0];
    expect(decryptSecret(kvSecretContext("tmdb:apiKey"), kvWrite.data.value)).toBe("tmdb-plain");

    const [accessWrite, refreshWrite] = prismaMock.traktToken.update.mock.calls.map((c) => c[0]);
    expect(decryptSecret(SECRET_CONTEXT.traktAccessToken, accessWrite.data.accessToken)).toBe("access-plain");
    expect(decryptSecret(SECRET_CONTEXT.traktRefreshToken, refreshWrite.data.refreshToken)).toBe("refresh-plain");

    const stremioWrite = prismaMock.stremioAuth.update.mock.calls[0][0];
    expect(decryptSecret(SECRET_CONTEXT.stremioAuthKey, stremioWrite.data.authKey)).toBe("authkey-plain");

    const channelWrite = prismaMock.notificationChannel.update.mock.calls[0][0];
    expect(channelWrite.where).toEqual({ id: "chan-1" });
    expect(decryptSecret(SECRET_CONTEXT.notificationChannelToken, channelWrite.data.token)).toBe("gotify-plain");
  });

  it("leaves already-encrypted rows alone, so a restart isn't a rewrite", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      { key: "ai:config", value: encryptSecret(kvSecretContext("ai:config"), '{"url":"http://llm"}') },
    ]);

    const sweep = await run();

    expect(sweep).toEqual({ encrypted: 0, unreadable: [] });
    expect(prismaMock.kV.update).not.toHaveBeenCalled();
  });

  it("names every credential a rotated API_TOKEN has locked out, and does not overwrite them", async () => {
    prismaMock.kV.findMany.mockResolvedValue([
      { key: "tmdb:apiKey", value: encryptSecret(kvSecretContext("tmdb:apiKey"), "tmdb-key") },
    ]);
    prismaMock.stremioAuth.findMany.mockResolvedValue([
      { id: "default", authKey: encryptSecret(SECRET_CONTEXT.stremioAuthKey, "authkey") },
    ]);
    process.env.API_TOKEN = "rotated-token";

    const sweep = await run();

    expect(sweep.encrypted).toBe(0);
    expect(sweep.unreadable).toEqual(["tmdb:apiKey", "Stremio access key"]);
    expect(prismaMock.kV.update).not.toHaveBeenCalled();
    expect(prismaMock.stremioAuth.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { credentials: ["tmdb:apiKey", "Stremio access key"] },
      expect.stringContaining("API_TOKEN has changed")
    );
  });

  it("warns and touches nothing when there is no API_TOKEN to derive a key from", async () => {
    delete process.env.API_TOKEN;
    prismaMock.kV.findMany.mockResolvedValue([{ key: "tmdb:apiKey", value: "tmdb-plain" }]);

    const sweep = await run();

    expect(sweep).toEqual({ encrypted: 0, unreadable: [] });
    expect(prismaMock.kV.findMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("plaintext"));
  });

  it("only sweeps the KV rows that hold credentials", async () => {
    await run();

    const { where } = prismaMock.kV.findMany.mock.calls[0][0];
    expect(where.key.in).toEqual(["tmdb:apiKey", "omdb:apiKey", "rpdb:apiKey", "ai:config", "push:vapidKeys"]);
    expect(where.key.in).not.toContain("settings:language");
  });

  it("writes ciphertext that later reads can actually open", async () => {
    prismaMock.kV.findMany.mockResolvedValue([{ key: "push:vapidKeys", value: '{"publicKey":"pub"}' }]);

    await run();

    const written = prismaMock.kV.update.mock.calls[0][0].data.value;
    expect(isEncryptedSecret(written)).toBe(true);
    expect(JSON.parse(decryptSecret(kvSecretContext("push:vapidKeys"), written)!)).toEqual({ publicKey: "pub" });
  });
});
