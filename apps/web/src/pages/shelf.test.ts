import { describe, expect, it } from "vitest";
import type { CheckIn, Game, ListItemWithMeta, SeriesProgress } from "../api";
import {
  applyShelfFilter,
  buildShelf,
  checkinMinutesLeft,
  checkinProgress,
  checkinTitleId,
  countByKind,
  isGameInProgress,
  metaLine,
  shelfEntryFromGame,
  shelfEntryFromGameInProgress,
  shelfEntryFromListItem,
  shelfEntryFromSeriesProgress,
  shelfSummary,
} from "./shelf";
import { first } from "../test/present";

const listItem = (over: Partial<ListItemWithMeta> = {}): ListItemWithMeta => ({
  listId: "list-1",
  type: "movie",
  imdbId: "tt1",
  addedAt: "2026-03-01T00:00:00.000Z",
  metadata: { name: "Understudy", poster: "p.jpg", year: 2019, genres: [], rating: null },
  ...over,
});

const game = (over: Partial<Game> = {}): Game => ({
  id: "g1",
  igdbId: null,
  steamAppId: null,
  title: "Hollow Signal",
  coverUrl: null,
  releaseDate: null,
  genres: [],
  playtimeMinutes: 0,
  lastPlayedAt: null,
  rating: null,
  notes: null,
  finished: false,
  finishedAt: null,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  ...over,
});

const series = (over: Partial<SeriesProgress> = {}): SeriesProgress => ({
  imdbId: "tt9",
  name: "The Long Shore",
  lastSeason: 3,
  lastEpisode: 3,
  nextSeason: 3,
  nextEpisode: 4,
  ...over,
});

describe("metaLine", () => {
  it("drops the parts that aren't there rather than leaving a dangling separator", () => {
    expect(metaLine("Show", null, "S3 E4", undefined, "")).toBe("Show · S3 E4");
  });
});

describe("shelfEntryFromListItem", () => {
  it("names the kind in the row's own words, not in the API's", () => {
    expect(shelfEntryFromListItem(listItem()).meta).toBe("Film · 2019");
    expect(shelfEntryFromListItem(listItem({ type: "series" })).meta).toBe("Show · 2019");
  });

  it("falls back to the title captured on add before showing a bare IMDb id", () => {
    expect(shelfEntryFromListItem(listItem({ metadata: null, title: "Understudy" })).title).toBe("Understudy");
    expect(shelfEntryFromListItem(listItem({ metadata: null, title: null })).title).toBe("tt1");
  });

  it("draws no ruler — a list row knows nothing about how far in you are", () => {
    expect(shelfEntryFromListItem(listItem({ type: "series" })).ruler).toBeNull();
  });
});

describe("shelfEntryFromGame", () => {
  it("measures a game in hours, which is the unit it actually has", () => {
    expect(shelfEntryFromGame(game({ playtimeMinutes: 504 })).meta).toBe("Game · 8.4h");
    // Past ten hours the decimal stops saying anything and goes — see formatPlaytime.
    expect(shelfEntryFromGame(game({ playtimeMinutes: 1104 })).meta).toBe("Game · 18h");
  });

  it("says so when a game has been finished rather than showing a total that stopped moving", () => {
    expect(shelfEntryFromGame(game({ playtimeMinutes: 504, finished: true })).meta).toBe("Game · Finished");
  });

  it("gives hours no bar, because there is no denominator to draw one against", () => {
    expect(shelfEntryFromGame(game({ playtimeMinutes: 504 })).ruler).toBeNull();
  });
});

describe("check-in maths", () => {
  const checkin: CheckIn = {
    type: "episode",
    imdbId: "tt9-s3e4",
    seriesImdbId: "tt9",
    name: "The Weight of Water",
    season: 3,
    episode: 4,
    startedAt: "2026-09-09T20:00:00.000Z",
    expiresAt: "2026-09-09T21:00:00.000Z",
  };
  const at = (iso: string) => new Date(iso).getTime();

  it("reads the elapsed fraction between the start and the runtime's expiry", () => {
    expect(checkinProgress(checkin, at("2026-09-09T20:15:00.000Z"))).toBe(0.25);
  });

  it("clamps rather than running past 1 on a check-in left open", () => {
    expect(checkinProgress(checkin, at("2026-09-09T23:00:00.000Z"))).toBe(1);
  });

  it("has nothing to say without an expiry, which is where the runtime comes from", () => {
    expect(checkinProgress({ ...checkin, expiresAt: undefined })).toBeNull();
    expect(checkinMinutesLeft({ ...checkin, expiresAt: undefined })).toBeNull();
    expect(checkinProgress(null)).toBeNull();
  });

  it("counts the minutes left, and stops at zero rather than going negative", () => {
    expect(checkinMinutesLeft(checkin, at("2026-09-09T20:18:00.000Z"))).toBe(42);
    expect(checkinMinutesLeft(checkin, at("2026-09-09T22:00:00.000Z"))).toBe(0);
  });

  it("attributes an episode check-in to its series, which is what the shelf holds", () => {
    expect(checkinTitleId(checkin)).toBe("tt9");
    expect(checkinTitleId({ ...checkin, type: "movie", imdbId: "tt5", seriesImdbId: undefined })).toBe("tt5");
  });
});

describe("shelfEntryFromSeriesProgress", () => {
  it("ticks the season the viewer is in, not the series they are somewhere inside", () => {
    const entry = shelfEntryFromSeriesProgress(
      series({ seasonWatchedEpisodes: 3, seasonTotalEpisodes: 8, watchedEpisodes: 19, totalEpisodes: 24 }),
      null
    );

    expect(entry.ruler).toMatchObject({ value: 3, total: 8, discrete: true });
    expect(entry.meta).toBe("Show · S3 E4 of 8");
    expect(entry.trailing).toBe("3/8 ep");
  });

  it("falls back to the series total, and says so, when the season's length is unknown", () => {
    const entry = shelfEntryFromSeriesProgress(series({ watchedEpisodes: 19, totalEpisodes: 24 }), null);

    expect(entry.ruler).toMatchObject({ value: 19, total: 24 });
    expect(entry.ruler?.label).toBe("19 of 24 episodes watched");
    expect(entry.meta).toBe("Show · S3 E4");
  });

  /*
   * `seasonTotalEpisodes` / `seasonWatchedEpisodes` are both about `lastSeason`,
   * and the API moves `nextSeason` on once a season is finished. Pairing the two
   * across that boundary read "S4 E1 of 8" — where the 8 was season three — under
   * a ruler showing a complete 8 of 8.
   */
  it("stops borrowing the finished season's length once the next episode is in a new one", () => {
    const entry = shelfEntryFromSeriesProgress(
      series({
        lastSeason: 3,
        lastEpisode: 8,
        nextSeason: 4,
        nextEpisode: 1,
        seasonWatchedEpisodes: 8,
        seasonTotalEpisodes: 8,
        watchedEpisodes: 19,
        totalEpisodes: 24,
      }),
      null
    );

    expect(entry.meta).toBe("Show · S4 E1");
    // The series-wide numbers take over, because they are the ones that still
    // describe where the viewer is.
    expect(entry.ruler).toMatchObject({ value: 19, total: 24 });
    expect(entry.trailing).toBe("19/24 ep");
  });

  it("keeps the season's length while the next episode is still in that season", () => {
    const entry = shelfEntryFromSeriesProgress(
      series({ lastSeason: 3, lastEpisode: 3, nextSeason: 3, nextEpisode: 4, seasonWatchedEpisodes: 3, seasonTotalEpisodes: 8 }),
      null
    );

    expect(entry.meta).toBe("Show · S3 E4 of 8");
  });

  it("draws no ruler at all when TMDB knows neither total", () => {
    expect(shelfEntryFromSeriesProgress(series(), null).ruler).toBeNull();
    expect(shelfEntryFromSeriesProgress(series(), null).trailing).toBeNull();
  });

  it("part-fills the tick in flight and trades the count for the time left, on the checked-in show", () => {
    const checkin: CheckIn = {
      type: "episode",
      imdbId: "tt9-s3e4",
      seriesImdbId: "tt9",
      name: "The Weight of Water",
      startedAt: "2026-09-09T20:00:00.000Z",
      expiresAt: "2026-09-09T21:00:00.000Z",
    };
    const entry = shelfEntryFromSeriesProgress(
      series({ seasonWatchedEpisodes: 3, seasonTotalEpisodes: 8 }),
      checkin,
      new Date("2026-09-09T20:18:00.000Z").getTime()
    );

    expect(entry.ruler?.partial).toBeCloseTo(0.3, 5);
    expect(entry.trailing).toBe("42 min left");
  });

  it("leaves every other show's tick unfilled — one check-in is about one title", () => {
    const checkin: CheckIn = {
      type: "episode",
      imdbId: "tt-other",
      seriesImdbId: "tt-other",
      name: "Something else",
      startedAt: "2026-09-09T20:00:00.000Z",
      expiresAt: "2026-09-09T21:00:00.000Z",
    };
    const entry = shelfEntryFromSeriesProgress(
      series({ seasonWatchedEpisodes: 3, seasonTotalEpisodes: 8 }),
      checkin,
      new Date("2026-09-09T20:18:00.000Z").getTime()
    );

    expect(entry.ruler?.partial).toBe(0);
    expect(entry.trailing).toBe("3/8 ep");
  });
});

describe("isGameInProgress", () => {
  it("is played but not done — the only thing the schema can actually say", () => {
    expect(isGameInProgress(game({ playtimeMinutes: 600 }))).toBe(true);
    expect(isGameInProgress(game({ playtimeMinutes: 0 }))).toBe(false);
    expect(isGameInProgress(game({ playtimeMinutes: 600, finished: true }))).toBe(false);
  });
});

describe("shelfEntryFromGameInProgress", () => {
  it("carries hours on the right and where it was last touched underneath", () => {
    const entry = shelfEntryFromGameInProgress(
      game({ playtimeMinutes: 504, lastPlayedAt: "2026-09-08T00:00:00.000Z" }),
      () => "1d ago"
    );

    expect(entry.trailing).toBe("8.4h");
    expect(entry.meta).toBe("Game · Played 1d ago");
  });
});

describe("buildShelf", () => {
  it("collapses a title that is in three lists into one thing on the shelf", () => {
    const shelf = buildShelf(
      [
        listItem({ listId: "a", addedAt: "2026-03-05T00:00:00.000Z" }),
        listItem({ listId: "b", addedAt: "2026-03-01T00:00:00.000Z" }),
        listItem({ listId: "c", addedAt: "2026-03-09T00:00:00.000Z" }),
      ],
      []
    );

    expect(shelf).toHaveLength(1);
    // The earliest add is when it actually arrived, whatever a later list says.
    expect(first(shelf, "shelf entry").addedAt).toBe(new Date("2026-03-01T00:00:00.000Z").getTime());
  });

  it("keeps a film and a series with the same id apart", () => {
    const shelf = buildShelf([listItem(), listItem({ type: "series" })], []);

    expect(shelf.map((entry) => entry.kind).sort()).toEqual(["film", "show"]);
  });

  it("puts everything in one order, newest first, across kinds", () => {
    const shelf = buildShelf(
      [listItem({ imdbId: "tt1", addedAt: "2026-01-01T00:00:00.000Z" })],
      [game({ id: "g1", createdAt: "2026-05-01T00:00:00.000Z" })]
    );

    expect(shelf.map((entry) => entry.kind)).toEqual(["game", "film"]);
  });

  it("files a row with no usable timestamp last, rather than at the epoch", () => {
    const shelf = buildShelf(
      [
        listItem({ imdbId: "tt-broken", addedAt: "not a date" }),
        listItem({ imdbId: "tt-real", addedAt: "2020-01-01T00:00:00.000Z" }),
      ],
      []
    );

    expect(shelf.map((entry) => entry.key)).toEqual(["movie:tt-real", "movie:tt-broken"]);
  });
});

describe("countByKind and applyShelfFilter", () => {
  const shelf = buildShelf(
    [listItem({ imdbId: "tt1" }), listItem({ imdbId: "tt2", type: "series" })],
    [game()]
  );

  it("counts what each filter would show, including the one that shows everything", () => {
    expect(countByKind(shelf)).toEqual({ all: 3, show: 1, film: 1, game: 1 });
  });

  it("narrows to one kind, and `all` narrows to nothing", () => {
    expect(applyShelfFilter(shelf, "game").map((entry) => entry.title)).toEqual(["Hollow Signal"]);
    expect(applyShelfFilter(shelf, "all")).toHaveLength(3);
  });
});

describe("shelfSummary", () => {
  it("counts the kinds on this shelf, not the kinds the app supports", () => {
    const shelf = buildShelf([listItem()], []);

    expect(shelfSummary(shelf, null)).toBe("1 title · 1 kind");
  });

  it("appends how recently anything moved, when there is anything to say", () => {
    const shelf = buildShelf([listItem({ imdbId: "tt1" }), listItem({ imdbId: "tt2" })], [game()]);

    expect(shelfSummary(shelf, "Last watched 2h ago")).toBe("3 titles · 2 kinds · Last watched 2h ago");
  });
});
