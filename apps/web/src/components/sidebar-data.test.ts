import { describe, expect, it } from "vitest";
import type { CatalogList } from "../api";
import type { SectionHealth } from "./settings/health";
import { LIST_TINTS, listTint, orderListsForRail, RAIL_SOURCES, railSources } from "./sidebar-data";

const list = (over: Partial<CatalogList> = {}): CatalogList => ({
  id: "l1",
  name: "Watchlist",
  kind: "custom",
  itemCount: 0,
  ...over,
});

const ok = (label = "Synced 4m ago"): SectionHealth => ({ tone: "ok", label });

describe("listTint", () => {
  /*
   * The two lists every profile has are the ones worth recognising across
   * installs — a green watchlist should be a green watchlist on someone else's
   * screen too.
   */
  it("gives the two built-in lists a fixed colour each", () => {
    expect(listTint(list({ kind: "watchlist" }))).toBe("var(--tint-green)");
    expect(listTint(list({ kind: "collection" }))).toBe("var(--tint-blue)");
    // And neither is in the pool the custom lists draw from, so a custom list
    // can never be mistaken for one of them.
    expect(LIST_TINTS).not.toContain("var(--tint-green)" as never);
    expect(LIST_TINTS).not.toContain("var(--tint-blue)" as never);
  });

  it("hashes a custom list to a stable colour out of the palette", () => {
    const a = listTint(list({ id: "abc", kind: "custom" }));
    expect(LIST_TINTS).toContain(a as (typeof LIST_TINTS)[number]);
    expect(listTint(list({ id: "abc", kind: "custom" }))).toBe(a);
  });

  /*
   * Hashing the id rather than the name is the whole point: the dot is the
   * list's identity, and renaming a list does not make it a different list.
   */
  it("keeps a renamed list's colour, because it is the same list", () => {
    const before = listTint(list({ id: "abc", name: "Movie Night", kind: "custom" }));
    const after = listTint(list({ id: "abc", name: "Friday Films", kind: "custom" }));
    expect(after).toBe(before);
  });
});

describe("orderListsForRail", () => {
  it("leads with the watchlist and the collection, then sorts the rest by name", () => {
    const ordered = orderListsForRail([
      list({ id: "z", name: "Zombies", kind: "custom" }),
      list({ id: "c", name: "Collection", kind: "collection" }),
      list({ id: "a", name: "Anime", kind: "custom" }),
      list({ id: "w", name: "Watchlist", kind: "watchlist" }),
    ]);

    expect(ordered.map((l) => l.name)).toEqual(["Watchlist", "Collection", "Anime", "Zombies"]);
  });

  it("does not reorder the array it was handed", () => {
    const input = [list({ id: "z", name: "Zombies" }), list({ id: "w", kind: "watchlist" })];
    orderListsForRail(input);
    expect(input.map((l) => l.id)).toEqual(["z", "w"]);
  });
});

describe("railSources", () => {
  it("draws a row for each source that is set up, in a fixed order", () => {
    const rows = railSources({ tmdb: ok("Key set"), trakt: ok() });
    expect(rows.map((r) => r.id)).toEqual(["trakt", "tmdb"]);
    expect(rows.map((r) => r.label)).toEqual(["Trakt", "TMDB"]);
  });

  /*
   * A source nobody has configured is doing exactly what it was asked to. Five
   * rows reading "Not set" would be a permanent to-do list in the chrome of
   * every screen.
   */
  it("leaves out a source nobody has set up", () => {
    expect(railSources({ omdb: { tone: "idle", label: "Not set" } })).toEqual([]);
  });

  /*
   * The same distinction the Settings page draws: "we asked and there is no
   * key" is an answer, "we could not ask" is not — and neither is worth a dot.
   */
  it("leaves out a source whose status could not be read at all", () => {
    expect(railSources({})).toEqual([]);
  });

  it("prints the short status where the mapper wrote one, and the label otherwise", () => {
    const rows = railSources({
      trakt: ok("Synced 4m ago"),
      tmdb: { tone: "warn", label: "No key — artwork is off", short: "No key" },
    });

    expect(rows.map((r) => r.status)).toEqual(["Synced 4m ago", "No key"]);
    // The unabbreviated sentence survives on the row, for its `title`.
    expect(rows[1].health.label).toBe("No key — artwork is off");
  });

  /*
   * Sync Status is health, and it is the one entry that is about this server's
   * own scheduled work rather than about a source. A row for it in a section
   * called "Sources" would be claiming the server is a place history comes from.
   */
  it("never draws the server's own job status as a source", () => {
    expect(RAIL_SOURCES.map((s) => s.id)).not.toContain("job-status");
    expect(railSources({ "job-status": ok("All healthy") })).toEqual([]);
  });
});
