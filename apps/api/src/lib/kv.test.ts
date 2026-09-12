import { beforeEach, describe, expect, it, vi } from "vitest";

// The point of this cache is that `getTmdb()` stops paying two KV round trips
// per call on paths that run per request. The risk it introduces is staleness,
// so most of what is below is about a write being visible immediately.

const prismaMock = {
  kV: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
};
vi.mock("./prisma.js", () => ({ prisma: prismaMock }));

const { readKv, writeKv, deleteKv, invalidateKv } = await import("./kv.js");
const { kvCacheClear } = await import("./cache.js");

const KEY = "settings:language";

/** A promise that only settles when the test says so. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  kvCacheClear();
  vi.clearAllMocks();
  prismaMock.kV.findUnique.mockResolvedValue({ key: KEY, value: "en-US" });
  prismaMock.kV.upsert.mockResolvedValue({});
  prismaMock.kV.deleteMany.mockResolvedValue({ count: 1 });
});

describe("readKv", () => {
  it("reads the row once and serves the rest from memory", async () => {
    await expect(readKv(KEY)).resolves.toBe("en-US");
    await expect(readKv(KEY)).resolves.toBe("en-US");

    expect(prismaMock.kV.findUnique).toHaveBeenCalledTimes(1);
  });

  // A fresh install has no language or region row, and those are read on every
  // request — caching only the hits would leave the common case uncached.
  it("caches the absence of a row too", async () => {
    prismaMock.kV.findUnique.mockResolvedValue(null);

    await expect(readKv(KEY)).resolves.toBeNull();
    await expect(readKv(KEY)).resolves.toBeNull();

    expect(prismaMock.kV.findUnique).toHaveBeenCalledTimes(1);
  });

  // The dashboard fires its requests in parallel, so they all reach a cold key
  // before the first read resolves. Without this the burst doesn't collapse.
  it("shares one read between callers that arrive together", async () => {
    const row = deferred<{ key: string; value: string }>();
    prismaMock.kV.findUnique.mockReturnValue(row.promise);

    const reads = Promise.all([readKv(KEY), readKv(KEY), readKv(KEY)]);
    row.resolve({ key: KEY, value: "fr-FR" });

    await expect(reads).resolves.toEqual(["fr-FR", "fr-FR", "fr-FR"]);
    expect(prismaMock.kV.findUnique).toHaveBeenCalledTimes(1);
  });

  it("reads again once the value has been invalidated", async () => {
    await readKv(KEY);
    invalidateKv(KEY);
    await readKv(KEY);

    expect(prismaMock.kV.findUnique).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart", async () => {
    prismaMock.kV.findUnique.mockImplementation(({ where }: { where: { key: string } }) =>
      Promise.resolve({ key: where.key, value: where.key === KEY ? "en-US" : "US" })
    );

    await expect(readKv(KEY)).resolves.toBe("en-US");
    await expect(readKv("settings:region")).resolves.toBe("US");
  });
});

describe("writeKv", () => {
  it("makes the new value readable straight away, without another query", async () => {
    await readKv(KEY);
    await writeKv(KEY, "fr-FR");
    prismaMock.kV.findUnique.mockResolvedValue({ key: KEY, value: "fr-FR" });

    await expect(readKv(KEY)).resolves.toBe("fr-FR");
  });

  // A read that started before the write can resolve after it. Caching what it
  // found would put the pre-write value back for a whole TTL.
  it("discards a read that was already in flight when it wrote", async () => {
    const row = deferred<{ key: string; value: string }>();
    prismaMock.kV.findUnique.mockReturnValue(row.promise);

    const stale = readKv(KEY);
    await writeKv(KEY, "fr-FR");
    row.resolve({ key: KEY, value: "en-US" });
    await stale;

    prismaMock.kV.findUnique.mockResolvedValue({ key: KEY, value: "fr-FR" });
    await expect(readKv(KEY)).resolves.toBe("fr-FR");
  });
});

describe("deleteKv", () => {
  it("removes the row and stops serving the old value", async () => {
    await readKv(KEY);
    await deleteKv(KEY);

    expect(prismaMock.kV.deleteMany).toHaveBeenCalledWith({ where: { key: KEY } });

    prismaMock.kV.findUnique.mockResolvedValue(null);
    await expect(readKv(KEY)).resolves.toBeNull();
  });
});
