import { describe, expect, it } from "vitest";
import type { SearchResult } from "../api";
import { mergeByRelevance } from "./mergeSearchResults";

const result = (name: string, type: SearchResult["type"]): SearchResult => ({
  imdbId: `tt-${name.toLowerCase().replace(/\W+/g, "-")}`,
  type,
  name,
  year: null,
  poster: null,
  description: null,
  genres: [],
  rating: null,
  inWatchlist: false,
  inCollection: false,
  lists: [],
});

const names = (rows: SearchResult[]) => rows.map((r) => r.name);

describe("mergeByRelevance", () => {
  it("ranks by how closely the title matches before anything else", () => {
    const movies = [result("The Office Party", "movie")];
    const series = [result("Office", "series"), result("Office Space Race", "series")];

    // Exact hit, then prefix, then the word-start match buried mid-title —
    // regardless of which list each came from or where it sat in it.
    expect(names(mergeByRelevance(movies, series, "office"))).toEqual([
      "Office",
      "Office Space Race",
      "The Office Party",
    ]);
  });

  it("falls back to each result's own position, then movies before series", () => {
    // Nothing matches the query, so every row scores zero and the tie-breakers
    // are all that is left: rank first, and at equal rank the movie leads —
    // which is the alternating interleave this replaced.
    const movies = [result("Alpha", "movie"), result("Beta", "movie")];
    const series = [result("Gamma", "series"), result("Delta", "series")];

    expect(names(mergeByRelevance(movies, series, "zzz"))).toEqual([
      "Alpha",
      "Gamma",
      "Beta",
      "Delta",
    ]);
  });

  it("treats a query of only whitespace as no query at all", () => {
    const movies = [result("Dune", "movie")];
    const series = [result("Dune: Prophecy", "series")];

    expect(names(mergeByRelevance(movies, series, "   "))).toEqual(["Dune", "Dune: Prophecy"]);
  });

  it("matches a query whose characters are regex syntax literally", () => {
    // The word-start tier is a regex, so an unescaped `.` or `+` here would
    // match titles that share nothing with the query.
    const movies = [result("Wall-E", "movie"), result("Walk Hard", "movie")];

    expect(names(mergeByRelevance(movies, [], "wall-e"))).toEqual(["Wall-E", "Walk Hard"]);
    expect(names(mergeByRelevance([result("Se7en", "movie")], [], "s.7en"))).toEqual(["Se7en"]);
  });

  it("scores each row independently of how many rows precede it", () => {
    // The word-start matcher is compiled once and reused across the whole list
    // now. A `/g` flag on it would carry `lastIndex` from one title to the
    // next, so a row would score differently depending on its neighbours.
    const many = Array.from({ length: 12 }, () => result("Star Wars", "movie"));
    const merged = mergeByRelevance([...many, result("Wars", "movie")], [], "wars");

    // The exact hit wins from the back of a long list of word-start matches.
    expect(merged[0]?.name).toBe("Wars");
    expect(merged).toHaveLength(13);
  });

  it("keeps every result from both lists", () => {
    const movies = [result("A", "movie"), result("B", "movie")];
    const series = [result("C", "series")];

    expect(mergeByRelevance(movies, series, "a")).toHaveLength(3);
    expect(mergeByRelevance([], [], "a")).toEqual([]);
  });
});
