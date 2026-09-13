import { describe, expect, it } from "vitest";
import type { WatchEvent } from "../api";
import { historyItemImdbId, watchEventLabel, watchEventTitle } from "./watchEvents";

// `WatchEvent.name` comes from the metadata row rather than from the event, so
// it is null for anything nothing has been fetched for yet — a Trakt import
// that ran ahead of the metadata backfill is the usual way to end up with a
// screenful of them. The type used to say `string`, which is why five separate
// render sites reached for `event.name` directly and three of them went blank.
// These two helpers are the one answer now; the type is `string | null`.

const event = (over: Partial<WatchEvent> = {}): WatchEvent => ({
  id: "evt_1",
  imdbId: "tt0903747",
  seriesImdbId: "tt0903747",
  type: "episode",
  name: "Breaking Bad",
  watchedAt: "2026-09-10T18:30:00.000Z",
  dateUnknown: false,
  ...over,
});

describe("watchEventTitle", () => {
  it("uses the name when there is one", () => {
    expect(watchEventTitle(event())).toBe("Breaking Bad");
  });

  it("falls back to the imdb id rather than rendering nothing", () => {
    // The same fallback the API applies for a series with no metadata row, and
    // the only thing left on screen that says which title this was.
    expect(watchEventTitle(event({ name: null }))).toBe("tt0903747");
  });

  it("prefers the series id for an episode, which is what the row is about", () => {
    expect(watchEventTitle(event({ name: null, imdbId: "tt_episode", seriesImdbId: "tt_series" }))).toBe("tt_series");
  });

  it("falls back to the event's own id for a movie, which has no series", () => {
    expect(watchEventTitle(event({ name: null, type: "movie", seriesImdbId: undefined, imdbId: "tt0110912" }))).toBe(
      "tt0110912"
    );
  });

  it("treats an empty name as no name", () => {
    expect(watchEventTitle(event({ name: "" }))).toBe("tt0903747");
  });
});

describe("watchEventLabel", () => {
  it("carries the episode number, so two watches of one series differ", () => {
    expect(watchEventLabel(event({ season: 5, episode: 14 }))).toBe("Breaking Bad S5E14");
  });

  it("names a movie by itself", () => {
    expect(watchEventLabel(event({ type: "movie", name: "Dune" }))).toBe("Dune");
  });

  it("stays readable when the metadata row is missing", () => {
    expect(watchEventLabel(event({ name: null, season: 5, episode: 14 }))).toBe("this watch S5E14");
  });
});

describe("historyItemImdbId", () => {
  it("opens an episode row on its series, not on the episode", () => {
    expect(
      historyItemImdbId({ type: "episode", imdbId: "tt2301451", seriesImdbId: "tt0903747" })
    ).toBe("tt0903747");
  });

  it("falls back to the row's own id when an episode carries no series id", () => {
    expect(historyItemImdbId({ type: "episode", imdbId: "tt2301451" })).toBe("tt2301451");
  });

  it("leaves a movie row alone", () => {
    // A movie has no series to redirect to, and a stray `seriesImdbId` on one
    // must not hijack it.
    expect(
      historyItemImdbId({ type: "movie", imdbId: "tt0110912", seriesImdbId: "tt0903747" })
    ).toBe("tt0110912");
  });
});
