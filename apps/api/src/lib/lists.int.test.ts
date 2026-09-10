import { describe, expect, it } from "vitest";
import { ListKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { createProfile } from "./test-fixtures/int-db.js";
import { ensureDefaultCollection, getDefaultCollection } from "./collection.js";
import { ensureDefaultWatchlist, getDefaultWatchlist } from "./watchlist.js";
import { isUniqueConstraintError } from "./prisma-tolerant.js";

// The default watchlist and the default collection are singletons enforced by
// two partial unique indexes — a construction Prisma's schema DSL cannot
// express, so they exist only in migration SQL and only a real database has
// them. Every test here is one a mocked Prisma would pass without the indexes
// being there at all.

const watchlistsOf = (profileId: string) =>
  prisma.list.findMany({ where: { profileId, kind: ListKind.watchlist } });

const collectionsOf = (profileId: string) =>
  prisma.list.findMany({ where: { profileId, kind: ListKind.collection } });

describe("the default watchlist", () => {
  it("is created once and then found, not minted again", async () => {
    const profile = await createProfile();

    const first = await getDefaultWatchlist(profile.id);
    const second = await getDefaultWatchlist(profile.id);

    expect(second.id).toBe(first.id);
    expect(await watchlistsOf(profile.id)).toHaveLength(1);
  });

  it("survives being renamed, which is what used to mint a second one", async () => {
    const profile = await createProfile();
    const original = await getDefaultWatchlist(profile.id);

    await prisma.list.update({ where: { id: original.id }, data: { name: "Stuff to watch" } });

    const found = await getDefaultWatchlist(profile.id);
    expect(found.id).toBe(original.id);
    expect(found.name).toBe("Stuff to watch");
    expect(await watchlistsOf(profile.id)).toHaveLength(1);
  });

  it("is refused a second row by the database, not merely by the code", async () => {
    const profile = await createProfile();
    await getDefaultWatchlist(profile.id);

    const second = prisma.list.create({
      data: { kind: ListKind.watchlist, name: "Watchlist", profileId: profile.id },
    });

    await expect(second.catch((error) => isUniqueConstraintError(error))).resolves.toBe(true);
  });

  it("is created again after being deleted", async () => {
    const profile = await createProfile();
    const original = await getDefaultWatchlist(profile.id);

    await prisma.list.delete({ where: { id: original.id } });
    const replacement = await getDefaultWatchlist(profile.id);

    expect(replacement.id).not.toBe(original.id);
    expect(await watchlistsOf(profile.id)).toHaveLength(1);
  });

  it("is one per profile — a household is not one watchlist", async () => {
    // The index was written before profiles existed and keyed on `kind` alone,
    // so the second profile's watchlist was rejected as a duplicate of the
    // first's. Every route that resolves a watchlist 500s for that profile.
    const ada = await createProfile("Ada");
    const bob = await createProfile("Bob");

    const adaList = await getDefaultWatchlist(ada.id);
    const bobList = await getDefaultWatchlist(bob.id);

    expect(bobList.id).not.toBe(adaList.id);
    expect(await watchlistsOf(ada.id)).toHaveLength(1);
    expect(await watchlistsOf(bob.id)).toHaveLength(1);
  });

  it("is seeded for the default profile at startup", async () => {
    await createProfile();

    await ensureDefaultWatchlist();
    await ensureDefaultWatchlist();

    expect(await prisma.list.count({ where: { kind: ListKind.watchlist } })).toBe(1);
  });
});

describe("the default collection", () => {
  it("is created once and then found", async () => {
    const profile = await createProfile();

    const first = await getDefaultCollection(profile.id);
    const second = await getDefaultCollection(profile.id);

    expect(second.id).toBe(first.id);
    expect(await collectionsOf(profile.id)).toHaveLength(1);
  });

  it("is refused a second row by the database", async () => {
    const profile = await createProfile();
    await getDefaultCollection(profile.id);

    const second = prisma.list.create({
      data: { kind: ListKind.collection, name: "Collection", profileId: profile.id },
    });

    await expect(second.catch((error) => isUniqueConstraintError(error))).resolves.toBe(true);
  });

  it("is one per profile", async () => {
    const ada = await createProfile("Ada");
    const bob = await createProfile("Bob");

    expect((await getDefaultCollection(bob.id)).id).not.toBe((await getDefaultCollection(ada.id)).id);
  });

  it("is created again after being deleted", async () => {
    const profile = await createProfile();
    const original = await getDefaultCollection(profile.id);

    await prisma.list.delete({ where: { id: original.id } });

    expect((await getDefaultCollection(profile.id)).id).not.toBe(original.id);
  });

  it("is seeded for the default profile at startup", async () => {
    await createProfile();

    await ensureDefaultCollection();
    await ensureDefaultCollection();

    expect(await prisma.list.count({ where: { kind: ListKind.collection } })).toBe(1);
  });
});

describe("custom lists", () => {
  it("are not singletons — the constraint is scoped to the two default kinds", async () => {
    const profile = await createProfile();

    await prisma.list.create({ data: { kind: ListKind.custom, name: "Halloween", profileId: profile.id } });
    await prisma.list.create({ data: { kind: ListKind.custom, name: "Comfort films", profileId: profile.id } });

    expect(await prisma.list.count({ where: { profileId: profile.id, kind: ListKind.custom } })).toBe(2);
  });
});
