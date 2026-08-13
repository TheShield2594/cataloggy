import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { findUnique: vi.fn(), create: vi.fn() },
  pushSubscription: { findMany: vi.fn(), count: vi.fn(), delete: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const generateVAPIDKeys = vi.fn();
const setVapidDetails = vi.fn();
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => generateVAPIDKeys(),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: vi.fn(),
  },
}));

const KEYS = { publicKey: "vapid-public", privateKey: "vapid-private" };

const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.API_TOKEN = "push-token";
  generateVAPIDKeys.mockReturnValue(KEYS);
  prismaMock.kV.create.mockResolvedValue({});
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.API_TOKEN;
  else process.env.API_TOKEN = originalToken;
});

describe("getPushPublicKey", () => {
  it("encrypts the generated keypair before it is persisted", async () => {
    prismaMock.kV.findUnique.mockResolvedValue(null);
    const { getPushPublicKey } = await import("./push.js");
    const { decryptSecret, kvSecretContext } = await import("./secret-box.js");

    expect(await getPushPublicKey()).toBe("vapid-public");

    const { value } = prismaMock.kV.create.mock.calls[0][0].data;
    // The private half is the one that matters: it signs every push this
    // server sends, and it is the reason this row is a credential.
    expect(value).not.toContain("vapid-private");
    expect(JSON.parse(decryptSecret(kvSecretContext("push:vapidKeys"), value)!)).toEqual(KEYS);
  });

  it("reads an encrypted keypair back and configures web-push with it", async () => {
    const { encryptSecret, kvSecretContext } = await import("./secret-box.js");
    prismaMock.kV.findUnique.mockResolvedValue({
      value: encryptSecret(kvSecretContext("push:vapidKeys"), JSON.stringify(KEYS)),
    });
    const { getPushPublicKey } = await import("./push.js");

    expect(await getPushPublicKey()).toBe("vapid-public");
    expect(setVapidDetails).toHaveBeenCalledWith(expect.any(String), "vapid-public", "vapid-private");
    expect(generateVAPIDKeys).not.toHaveBeenCalled();
  });

  it("still reads a keypair stored before encryption at rest", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({ value: JSON.stringify(KEYS) });
    const { getPushPublicKey } = await import("./push.js");

    expect(await getPushPublicKey()).toBe("vapid-public");
    expect(generateVAPIDKeys).not.toHaveBeenCalled();
  });

  it("refuses rather than generating a new keypair when the stored one won't decrypt", async () => {
    const { encryptSecret, kvSecretContext } = await import("./secret-box.js");
    const stored = encryptSecret(kvSecretContext("push:vapidKeys"), JSON.stringify(KEYS));
    process.env.API_TOKEN = "rotated-token";
    prismaMock.kV.findUnique.mockResolvedValue({ value: stored });
    const { getPushPublicKey } = await import("./push.js");

    // Quietly minting a replacement would unsubscribe every browser that ever
    // subscribed, with nothing anywhere saying so.
    await expect(getPushPublicKey()).rejects.toThrow(/could not be decrypted/);
    expect(generateVAPIDKeys).not.toHaveBeenCalled();
    expect(prismaMock.kV.create).not.toHaveBeenCalled();
  });
});
