import { describe, expect, it } from "vitest";
import { buildMetaLine, nextEpisodeUp, formatRuntime, statusColor } from "./detailPanelUtils";

describe("formatRuntime", () => {
  it("keeps sub-hour runtimes in minutes", () => {
    expect(formatRuntime(0)).toBe("0m");
    expect(formatRuntime(42)).toBe("42m");
    expect(formatRuntime(59)).toBe("59m");
  });

  it("drops the minutes part on a whole number of hours", () => {
    expect(formatRuntime(60)).toBe("1h");
    expect(formatRuntime(120)).toBe("2h");
  });

  it("shows hours and minutes together otherwise", () => {
    expect(formatRuntime(61)).toBe("1h 1m");
    expect(formatRuntime(152)).toBe("2h 32m");
  });
});

describe("statusColor", () => {
  it("always returns a themed chip rather than a raw tint", () => {
    for (const status of ["Returning Series", "Ended", "Planned", "Released", ""]) {
      expect(statusColor(status)).toContain("status-chip");
      // A hard-coded -400/-500 tint is what made these unreadable on the light
      // theme; every status has to come from a --status-* token now.
      expect(statusColor(status)).not.toMatch(/-\d00\b/);
    }
  });

  it("marks running shows as ok", () => {
    expect(statusColor("Returning Series")).toContain("status-chip--ok");
    expect(statusColor("Ongoing")).toContain("status-chip--ok");
  });

  it("marks finished shows as bad", () => {
    expect(statusColor("Ended")).toContain("status-chip--bad");
    expect(statusColor("Canceled")).toContain("status-chip--bad");
    expect(statusColor("Cancelled")).toContain("status-chip--bad");
  });

  it("marks upcoming titles as warn", () => {
    expect(statusColor("In Production")).toContain("status-chip--warn");
    expect(statusColor("Planned")).toContain("status-chip--warn");
  });

  it("is case-insensitive", () => {
    expect(statusColor("ENDED")).toBe(statusColor("ended"));
    expect(statusColor("returning series")).toBe(statusColor("Returning Series"));
  });

  it("falls back to the neutral chip for anything unrecognised", () => {
    expect(statusColor("Released")).toBe("status-chip");
    expect(statusColor("")).toBe("status-chip");
  });
});

describe("buildMetaLine", () => {
  const full = {
    year: 2021,
    network: "Netflix",
    genres: ["Animation", "Action", "Adventure"],
  };

  it("orders the facts from most to least identifying", () => {
    expect(buildMetaLine(full)).toEqual(["2021", "Netflix", "Animation, Action, Adventure"]);
  });

  /*
   * The certification is not one of these. It is a classification awarded to
   * the work rather than a fact about it, and it is what a reader scans this
   * row for when they are deciding whether to put something on in a room with
   * other people — so the hero draws it as a bordered badge at the end of the
   * row instead of setting it as running text between the year and the network.
   */
  it("leaves the certification to the badge beside it", () => {
    expect(buildMetaLine({ ...full, certification: "TV-MA" } as typeof full)).not.toContain("TV-MA");
  });

  it("collapses genres into one segment rather than one each", () => {
    // Three genre chips read as three more unrelated facts beside the year and
    // the network; a comma-separated group reads as one.
    expect(buildMetaLine({ genres: ["Drama", "Crime"] })).toEqual(["Drama, Crime"]);
  });

  it("caps the genre list so the line stays shorter than the title", () => {
    expect(buildMetaLine({ genres: ["A", "B", "C", "D", "E"] })).toEqual(["A, B, C"]);
  });

  it("drops what a title doesn't have instead of leaving gaps", () => {
    expect(buildMetaLine({ year: 1999, network: null, genres: [] })).toEqual(["1999"]);
    expect(buildMetaLine({})).toEqual([]);
  });

  it("treats blank strings as absent, so the line never opens on a separator", () => {
    expect(buildMetaLine({ network: "", genres: ["  "] })).toEqual([]);
  });

  it("keeps a year of 0 out rather than printing it", () => {
    expect(buildMetaLine({ year: 0 })).toEqual([]);
  });
});

describe("nextEpisodeUp", () => {
  const seasons = [
    { seasonNumber: 1, episodeCount: 8 },
    { seasonNumber: 2, episodeCount: 10 },
  ];

  it("starts a show nobody has watched at the beginning", () => {
    expect(nextEpisodeUp([], seasons)).toEqual({ season: 1, episode: 1 });
  });

  it("offers the next episode up, mid-season", () => {
    expect(nextEpisodeUp([{ season: 2, episode: 4 }], seasons)).toEqual({ season: 2, episode: 5 });
  });

  it("rolls into the next season at the end of one", () => {
    expect(nextEpisodeUp([{ season: 1, episode: 8 }], seasons)).toEqual({ season: 2, episode: 1 });
  });

  /*
   * Episode N+1 of a season that doesn't exist is a label naming something
   * unwatchable. The finale again is a rewatch, which is a thing people do.
   */
  it("stops at the finale rather than inventing an episode past it", () => {
    expect(nextEpisodeUp([{ season: 2, episode: 10 }], seasons)).toEqual({ season: 2, episode: 10 });
  });

  /*
   * The bundle can fail, or a season can arrive with no length. Rolling over on
   * a count we were never told is how a show lands on an episode that isn't
   * there; counting up is right whenever the season is unfinished and harmless
   * when it isn't.
   */
  it("counts up when it does not know how long the season is", () => {
    expect(nextEpisodeUp([{ season: 3, episode: 2 }], seasons)).toEqual({ season: 3, episode: 3 });
    expect(nextEpisodeUp([{ season: 1, episode: 4 }], [])).toEqual({ season: 1, episode: 5 });
  });

  // History arrives newest-first, so the first dated row is the last watch.
  it("reads the most recent watch, not the oldest", () => {
    const history = [
      { season: 2, episode: 3 },
      { season: 1, episode: 1 },
    ];
    expect(nextEpisodeUp(history, seasons)).toEqual({ season: 2, episode: 4 });
  });

  // A film logged against a series, or a row the API left blank.
  it("skips history rows that name no episode", () => {
    const history = [{ season: null, episode: null }, { season: 1, episode: 2 }];
    expect(nextEpisodeUp(history, seasons)).toEqual({ season: 1, episode: 3 });
  });
});
