// The catalog registry and the api↔addon contracts live in @cataloggy/shared,
// but this service is the one that breaks when either does — it is the only
// consumer that reads the API over HTTP — so their tests live here, next to the
// code whose behaviour they protect.
import { describe, expect, it } from "vitest";
import {
  catalogRequiresAi,
  DEFAULT_DISCOVERY_CATALOG_IDS,
  discoveryApiPath,
  DISCOVERY_CATALOGS,
  getDiscoveryCatalog,
  isDiscoveryCatalogId,
  listCatalogId,
  migrateLegacyCatalogs,
  parseAddonConfigResponse,
  parseGenresResponse,
  parseListItemsResponse,
  parseListsResponse,
  parseMetasResponse,
  parseListCatalogId,
  parseProfilesResponse,
  parseRpdbConfigResponse,
  parseSeriesProgressResponse,
  selectDiscoveryCatalogs,
  ApiContractError,
} from "@cataloggy/shared";

describe("catalog registry", () => {
  it("declares every catalog exactly once", () => {
    const ids = DISCOVERY_CATALOGS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every catalog a label distinct from its id", () => {
    for (const catalog of DISCOVERY_CATALOGS) {
      expect(catalog.label.trim()).not.toBe("");
      expect(catalog.label).not.toBe(catalog.id);
    }
  });

  it("points every catalog at an API path carrying its own type", () => {
    for (const catalog of DISCOVERY_CATALOGS) {
      expect(discoveryApiPath(catalog)).toContain(`type=${catalog.type}`);
    }
  });

  it("names a provider in every streaming catalog's path", () => {
    const streaming = DISCOVERY_CATALOGS.filter((c) => c.source.kind === "streaming");
    expect(streaming.length).toBeGreaterThan(0);
    for (const catalog of streaming) {
      expect(discoveryApiPath(catalog)).toMatch(/provider=[a-z]+/);
    }
  });

  it("defaults to catalogs it actually declares", () => {
    for (const id of DEFAULT_DISCOVERY_CATALOG_IDS) {
      expect(isDiscoveryCatalogId(id)).toBe(true);
    }
  });

  it("treats only the AI catalogs as needing a provider", () => {
    const gated = DISCOVERY_CATALOGS.filter(catalogRequiresAi).map((c) => c.id);
    expect(gated).toEqual(["cataloggy-ai-movie", "cataloggy-ai-series"]);
  });

  it("does not mistake a list catalog for a discovery one", () => {
    expect(getDiscoveryCatalog("list:abc")).toBeNull();
    expect(parseListCatalogId(listCatalogId("abc"))).toBe("abc");
    expect(parseListCatalogId("cataloggy-trending-movie")).toBeNull();
  });

  it("translates the catalog ids written by the first version of the picker", () => {
    expect(migrateLegacyCatalogs(["my_watchlist_movies", "cataloggy-anime-movie"])).toEqual([
      "cataloggy-trending-movie",
      "cataloggy-anime-movie",
    ]);
  });
});

describe("selectDiscoveryCatalogs", () => {
  it("keeps only what the profile enabled", () => {
    const selected = selectDiscoveryCatalogs(["cataloggy-popular-movie", "list:abc"], { aiConfigured: true });
    expect(selected.map((c) => c.id)).toEqual(["cataloggy-popular-movie"]);
  });

  it("withholds the AI catalogs until a provider exists", () => {
    const enabled = ["cataloggy-ai-movie", "cataloggy-popular-movie"];
    expect(selectDiscoveryCatalogs(enabled, { aiConfigured: false }).map((c) => c.id)).toEqual([
      "cataloggy-popular-movie",
    ]);
    expect(selectDiscoveryCatalogs(enabled, { aiConfigured: true }).map((c) => c.id)).toEqual([
      "cataloggy-popular-movie",
      "cataloggy-ai-movie",
    ]);
  });
});

describe("response parsers", () => {
  it("accepts the shape the API sends and drops the rest", () => {
    const parsed = parseMetasResponse({
      metas: [{ id: "tt1", type: "movie", name: "A", poster: "p", genres: ["Drama"], tmdbId: 5 }],
    });
    expect(parsed.metas).toEqual([
      { id: "tt1", type: "movie", name: "A", poster: "p", year: undefined, description: undefined, genres: ["Drama"], rating: undefined },
    ]);
  });

  it("rejects a meta with no name rather than serving an undefined row", () => {
    expect(() => parseMetasResponse({ metas: [{ id: "tt1", type: "movie" }] })).toThrow(ApiContractError);
  });

  it("rejects a catalog type Stremio has no notion of", () => {
    expect(() => parseMetasResponse({ metas: [{ id: "tt1", type: "game", name: "A" }] })).toThrow(
      /must be "movie" or "series"/
    );
  });

  it("names the field that broke", () => {
    expect(() => parseMetasResponse({ metas: [{ id: "tt1", type: "movie", name: "A", year: "1994" }] })).toThrow(
      /metas\[0\]\.year/
    );
  });

  it("rejects a body that isn't an object at all", () => {
    expect(() => parseMetasResponse("nope")).toThrow(ApiContractError);
    expect(() => parseGenresResponse({ genres: "Drama" })).toThrow(/genres must be an array/);
  });

  it("reads every list kind the API can send", () => {
    const parsed = parseListsResponse({
      lists: [
        { id: "1", name: "Watchlist", kind: "watchlist", createdAt: "2026-01-01", itemCount: 3 },
        { id: "2", name: "Weekend", kind: "custom" },
        { id: "3", name: "Collection", kind: "collection" },
      ],
    });
    expect(parsed.lists).toEqual([
      { id: "1", name: "Watchlist", kind: "watchlist" },
      { id: "2", name: "Weekend", kind: "custom" },
      { id: "3", name: "Collection", kind: "collection" },
    ]);
  });

  it("rejects a list kind that has no catalog rule", () => {
    expect(() => parseListsResponse({ lists: [{ id: "1", name: "X", kind: "games" }] })).toThrow(
      ApiContractError
    );
  });

  it("keeps an item that has no metadata row yet", () => {
    const parsed = parseListItemsResponse({
      items: [{ imdbId: "tt1", type: "movie", title: "Fallback", metadata: null }],
    });
    expect(parsed.items[0]).toEqual({ imdbId: "tt1", type: "movie", title: "Fallback", metadata: null });
  });

  it("reads an item's metadata, nulls and all", () => {
    const parsed = parseListItemsResponse({
      items: [
        {
          imdbId: "tt1",
          type: "movie",
          metadata: { name: "A", poster: null, year: null, genres: ["Drama"], rating: 8.1 },
        },
      ],
    });
    expect(parsed.items[0].metadata).toEqual({
      name: "A",
      poster: null,
      year: null,
      genres: ["Drama"],
      rating: 8.1,
    });
    expect(parsed.items[0].title).toBeNull();
  });

  it("reads the enabled catalogs and the AI flag", () => {
    expect(parseAddonConfigResponse({ config: { enabledCatalogs: ["a"] }, aiConfigured: true })).toEqual({
      enabledCatalogs: ["a"],
      aiConfigured: true,
    });
  });

  it("assumes AI is available when an older API omits the flag", () => {
    // The API has already dropped the AI catalogs itself if it has no provider,
    // so defaulting to false here would hide catalogs a user did enable.
    expect(parseAddonConfigResponse({ config: { enabledCatalogs: ["cataloggy-ai-movie"] } })).toEqual({
      enabledCatalogs: ["cataloggy-ai-movie"],
      aiConfigured: true,
    });
  });

  it("rejects a config with no enabled-catalog array", () => {
    expect(() => parseAddonConfigResponse({ config: {} })).toThrow(ApiContractError);
  });

  it("reads the RPDB key and treats a missing one as absent", () => {
    expect(parseRpdbConfigResponse({ enabled: true, apiKey: "k" })).toEqual({ enabled: true, apiKey: "k" });
    expect(parseRpdbConfigResponse({ enabled: false })).toEqual({ enabled: false, apiKey: null });
  });

  it("reads the oldest profile the API lists first", () => {
    expect(parseProfilesResponse({ profiles: [{ id: "a", name: "A" }, { id: "b" }] }).profiles).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("reads series progress and reports no row as no progress", () => {
    expect(parseSeriesProgressResponse({})).toEqual({});
    expect(
      parseSeriesProgressResponse({
        progress: { lastSeason: 2, lastEpisode: 5, totalEpisodes: 10, watchedEpisodes: 10 },
      }).progress
    ).toEqual({ lastSeason: 2, lastEpisode: 5, totalEpisodes: 10, watchedEpisodes: 10 });
  });
});
