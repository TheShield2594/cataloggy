import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailedWatchStats, WatchStats, YearInReviewStats } from "../api";
import { StatsPage } from "./StatsPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: { getWatchStats: vi.fn(), getDetailedStats: vi.fn(), getYearInReview: vi.fn() },
  };
});

const { api } = await import("../api");
const getWatchStats = vi.mocked(api.getWatchStats);
const getDetailedStats = vi.mocked(api.getDetailedStats);
const getYearInReview = vi.mocked(api.getYearInReview);

const CURRENT_YEAR = new Date().getFullYear();

const summary: WatchStats = { totalMovies: 0, totalEpisodes: 0, totalPlays: 0, playsThisWeek: 0 };
const detailed: DetailedWatchStats = {
  monthly: [],
  genreDistribution: [],
  currentStreak: 0,
  longestStreak: 0,
  topRated: [],
};
const yearReview = (year: number): YearInReviewStats => ({
  year,
  totalMovies: 0,
  totalEpisodes: 0,
  totalRuntimeMinutes: 0,
  topGenres: [],
  topRated: [],
  busiestMonth: null,
  busiestMonthCount: 0,
});

describe("StatsPage — Year in Review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    getWatchStats.mockResolvedValue(summary);
    getDetailedStats.mockResolvedValue(detailed);
    getYearInReview.mockImplementation(async (year: number) => yearReview(year));
  });

  const yearPicker = () => screen.getByLabelText("Year in review: year") as HTMLSelectElement;

  it("opens on the year you are in, not the one that just ended", async () => {
    render(<StatsPage />);

    await waitFor(() => expect(getYearInReview).toHaveBeenCalled());
    expect(getYearInReview).toHaveBeenCalledWith(CURRENT_YEAR);
    expect(yearPicker().value).toBe(String(CURRENT_YEAR));
  });

  it("lists the current year first and still offers the earlier ones", async () => {
    render(<StatsPage />);

    await waitFor(() => expect(getYearInReview).toHaveBeenCalled());
    const options = Array.from(yearPicker().options).map((option) => option.value);
    expect(options[0]).toBe(String(CURRENT_YEAR));
    expect(options).toContain(String(CURRENT_YEAR - 1));
  });

  it("loads the year the reader picks", async () => {
    render(<StatsPage />);
    await waitFor(() => expect(getYearInReview).toHaveBeenCalled());

    await userEvent.selectOptions(yearPicker(), String(CURRENT_YEAR - 1));

    await waitFor(() => expect(getYearInReview).toHaveBeenCalledWith(CURRENT_YEAR - 1));
    expect(yearPicker().value).toBe(String(CURRENT_YEAR - 1));
  });
});
