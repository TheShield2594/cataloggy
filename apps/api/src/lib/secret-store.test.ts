import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  kV: { findUnique: vi.fn(), upsert: vi.fn() },
};

vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const { readSecretKv, writeSecretKv } = await import("./secret-store.js");
const { decryptSecret, encryptSecret, kvSecretContext } = await import("./secret-box.js");

const originalToken = process.env.API_TOKEN;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.kV.upsert.mockResolvedValue({});
  process.env.API_TOKEN = "secret-store-token";
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.API_TOKEN;
  else process.env.API_TOKEN = originalToken;
});

describe("writeSecretKv", () => {
  it("writes ciphertext, not the value it was given", async () => {
    await writeSecretKv("tmdb:apiKey", "tmdb-secret");

    const call = prismaMock.kV.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ key: "tmdb:apiKey" });
    expect(call.create.value).not.toContain("tmdb-secret");
    expect(call.update.value).toBe(call.create.value);
    expect(decryptSecret(kvSecretContext("tmdb:apiKey"), call.create.value)).toBe("tmdb-secret");
  });
});

describe("readSecretKv", () => {
  it("returns null when there is no row", async () => {
    prismaMock.kV.findUnique.mockResolvedValue(null);

    expect(await readSecretKv("omdb:apiKey")).toBeNull();
  });

  it("decrypts what writeSecretKv stored", async () => {
    await writeSecretKv("omdb:apiKey", "omdb-secret");
    prismaMock.kV.findUnique.mockResolvedValue({ value: prismaMock.kV.upsert.mock.calls[0][0].create.value });

    expect(await readSecretKv("omdb:apiKey")).toBe("omdb-secret");
  });

  it("still reads a row left in plaintext by an older version", async () => {
    prismaMock.kV.findUnique.mockResolvedValue({ value: "written-before-encryption" });

    expect(await readSecretKv("rpdb:apiKey")).toBe("written-before-encryption");
  });

  it("reads as absent — not as garbage — once API_TOKEN has been rotated", async () => {
    const stored = encryptSecret(kvSecretContext("rpdb:apiKey"), "rpdb-secret");
    prismaMock.kV.findUnique.mockResolvedValue({ value: stored });
    process.env.API_TOKEN = "a-different-token";

    expect(await readSecretKv("rpdb:apiKey")).toBeNull();
  });

  it("keeps each row's ciphertext to its own key", async () => {
    const stored = encryptSecret(kvSecretContext("tmdb:apiKey"), "tmdb-secret");
    prismaMock.kV.findUnique.mockResolvedValue({ value: stored });

    expect(await readSecretKv("omdb:apiKey")).toBeNull();
  });
});
