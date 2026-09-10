import { describe, expect, it } from "vitest";
import {
  ApiContractError,
  parseCalendarResponse,
  parseSeriesProgressListResponse,
  parseWatchHistoryResponse,
} from "./api-contracts.js";

// These three parsers exist for one scenario, and it is the scenario
// `CATALOGGY_IMAGE_TAG` deliberately makes possible: a `web` container talking
// to an `api` container from a different build. Each test below is a shape an
// older or newer API could plausibly send, and the assertion is the same one
// every time — the request fails, loudly and by name, rather than handing a
// half-built object to code that will destructure it.

/** The same row an older API sends, minus a field it did not have yet. */
const without = <T extends object>(row: T, field: keyof T): Omit<T, typeof field> => {
  const copy = { ...row };
  delete copy[field];
  return copy;
};

const entry = () => ({
  seriesImdbId: "tt0903747",
  seriesName: "Breaking Bad",
  poster: "/poster.jpg",
  season: 5,
  episode: 14,
  episodeName: "Ozymandias",
  airDate: "2026-09-14",
  overview: null,
});

describe("parseCalendarResponse", () => {
  it("returns the entries an API of the same build sends", () => {
    expect(parseCalendarResponse({ calendar: [entry()] })).toEqual({ calendar: [entry()] });
  });

  it("treats a missing calendar key as an empty calendar", () => {
    // A profile with nothing upcoming is not a contract violation.
    expect(parseCalendarResponse({})).toEqual({ calendar: [] });
    expect(parseCalendarResponse({ calendar: [] })).toEqual({ calendar: [] });
  });

  // The case in the issue: `entry.airDate.split("-")` on an entry that has no
  // airDate is a TypeError inside a `.map`, which the app's single global
  // ErrorBoundary turns into a blank page for every route, not just this one.
  it("rejects an entry with no airDate, rather than letting a .split find undefined", () => {
    const withoutAirDate = without(entry(), "airDate");
    expect(() => parseCalendarResponse({ calendar: [withoutAirDate] })).toThrow(ApiContractError);
    expect(() => parseCalendarResponse({ calendar: [withoutAirDate] })).toThrow(/calendar\[0\]\.airDate/);
  });

  // A string that is a string but not a date passes every type check and then
  // formats as the literal text "Invalid Date" on the screen, days from the
  // build that caused it.
  it("rejects an airDate that is a string but not a date", () => {
    for (const airDate of ["", "soon", "14/09/2026", "2026-09-14T00:00:00Z"]) {
      expect(() => parseCalendarResponse({ calendar: [{ ...entry(), airDate }] })).toThrow(ApiContractError);
    }
  });

  it("names the entry that is wrong, not just the field", () => {
    const calendar = [entry(), entry(), { ...entry(), season: "5" }];
    expect(() => parseCalendarResponse({ calendar })).toThrow(/calendar\[2\]\.season must be a number/);
  });

  it("rejects a calendar that is not a list at all", () => {
    expect(() => parseCalendarResponse({ calendar: { "0": entry() } })).toThrow(/calendar must be an array/);
    expect(() => parseCalendarResponse(null)).toThrow(/response must be an object/);
  });

  it("keeps a null poster and overview, which are the API's own absence", () => {
    const sparse = { ...entry(), poster: null, overview: null };
    expect(parseCalendarResponse({ calendar: [sparse] }).calendar[0]).toMatchObject({
      poster: null,
      overview: null,
    });
  });
});

const progress = () => ({
  imdbId: "tt0903747",
  name: "Breaking Bad",
  poster: "/poster.jpg",
  background: "/backdrop.jpg",
  lastSeason: 5,
  lastEpisode: 13,
  nextSeason: 5,
  nextEpisode: 14,
  totalSeasons: 5,
  totalEpisodes: 62,
  watchedEpisodes: 61,
  seasonTotalEpisodes: 16,
  seasonWatchedEpisodes: 13,
});

describe("parseSeriesProgressListResponse", () => {
  it("returns the rows an API of the same build sends", () => {
    expect(parseSeriesProgressListResponse({ progress: [progress()] })).toEqual({ progress: [progress()] });
  });

  // "Continue · S5 E14" is a button that marks an episode watched. A row that
  // cannot say which episode it means has to fail, not render.
  it.each(["lastSeason", "lastEpisode", "nextSeason", "nextEpisode"] as const)(
    "rejects a row with no %s",
    (field) => {
      const row = without(progress(), field);
      expect(() => parseSeriesProgressListResponse({ progress: [row] })).toThrow(
        new RegExp(`progress\\[0\\]\\.${field} must be a number`)
      );
    }
  );

  // Everything the metadata row supplies can legitimately be absent: a series
  // TMDB has nothing for still has progress worth showing.
  it("accepts a row with no metadata behind it", () => {
    expect(
      parseSeriesProgressListResponse({
        progress: [
          {
            imdbId: "tt9999999",
            name: "tt9999999",
            lastSeason: 1,
            lastEpisode: 2,
            nextSeason: 1,
            nextEpisode: 3,
          },
        ],
      }).progress[0]
    ).toEqual({
      imdbId: "tt9999999",
      name: "tt9999999",
      poster: undefined,
      background: null,
      lastSeason: 1,
      lastEpisode: 2,
      nextSeason: 1,
      nextEpisode: 3,
      totalSeasons: null,
      totalEpisodes: null,
      watchedEpisodes: null,
      seasonTotalEpisodes: null,
      seasonWatchedEpisodes: null,
    });
  });

  it("rejects a count that arrives as a string", () => {
    expect(() =>
      parseSeriesProgressListResponse({ progress: [{ ...progress(), totalEpisodes: "62" }] })
    ).toThrow(/progress\[0\]\.totalEpisodes must be a number/);
  });
});

const event = () => ({
  id: "evt_1",
  imdbId: "tt0903747",
  seriesImdbId: "tt0903747",
  type: "episode" as const,
  name: "Breaking Bad",
  poster: "/poster.jpg",
  season: 5,
  episode: 14,
  watchedAt: "2026-09-10T18:30:00.000Z",
  dateUnknown: false,
  note: null,
});

describe("parseWatchHistoryResponse", () => {
  it("returns the events an API of the same build sends", () => {
    expect(parseWatchHistoryResponse({ history: [event()] })).toEqual({ history: [event()] });
  });

  it("drops the columns the API spreads but the client never reads", () => {
    // `serializeWatchEvent` spreads the whole Prisma row, so `plays`,
    // `profileId` and `traktHistoryId` ride along. Nothing may come to depend
    // on a field that was never validated.
    const parsed = parseWatchHistoryResponse({
      history: [{ ...event(), plays: 3, profileId: "p_1", traktHistoryId: "9001" }],
    });
    expect(parsed.history[0]).not.toHaveProperty("plays");
    expect(parsed.history[0]).not.toHaveProperty("profileId");
    expect(parsed.history[0]).not.toHaveProperty("traktHistoryId");
  });

  // `name` and `poster` come from the metadata row rather than the event, so a
  // Trakt import that ran ahead of the metadata backfill produces exactly this
  // — which the type used to claim was impossible.
  it("keeps a null name, because the API really does send one", () => {
    const parsed = parseWatchHistoryResponse({ history: [{ ...event(), name: null, poster: null }] });
    expect(parsed.history[0]).toMatchObject({ name: null, poster: undefined });
  });

  it("rejects a type it has no branch for", () => {
    expect(() => parseWatchHistoryResponse({ history: [{ ...event(), type: "game" }] })).toThrow(
      /history\[0\]\.type must be "movie" or "episode"/
    );
  });

  it("rejects an event with no id, which every row's controls act on", () => {
    expect(() => parseWatchHistoryResponse({ history: [without(event(), "id")] })).toThrow(/history\[0\]\.id/);
  });

  // An API that predates the flag never had one to set, and every row it sends
  // is a dated one — so this is a default, not a violation.
  it("reads a missing dateUnknown as false", () => {
    const older = without(event(), "dateUnknown");
    expect(parseWatchHistoryResponse({ history: [older] }).history[0]?.dateUnknown).toBe(false);
  });

  it("rejects a dateUnknown that is present but not a boolean", () => {
    expect(() => parseWatchHistoryResponse({ history: [{ ...event(), dateUnknown: "no" }] })).toThrow(
      /history\[0\]\.dateUnknown must be a boolean/
    );
  });

  it("treats a missing history key as an empty history", () => {
    expect(parseWatchHistoryResponse({})).toEqual({ history: [] });
  });
});
