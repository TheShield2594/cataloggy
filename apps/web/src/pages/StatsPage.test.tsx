import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

// A profile with history. The zeroed version below is its own case now: with
// nothing watched the page is an empty state and never renders the panels these
// tests are about.
const summary: WatchStats = { totalMovies: 12, totalEpisodes: 40, totalPlays: 52, playsThisWeek: 3 };
const noHistory: WatchStats = { totalMovies: 0, totalEpisodes: 0, totalPlays: 0, playsThisWeek: 0 };
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
  // A 9 out of ten, which the panel has to draw as 4.5 out of five.
  topRated: [{ imdbId: "tt1", name: "Heat", type: "movie", rating: 9, poster: null }],
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

  it("shows your own ratings on the five-star scale", async () => {
    // Your rating, unlike the TMDB community score elsewhere on the page.
    render(<StatsPage />);

    await waitFor(() => expect(getYearInReview).toHaveBeenCalled());
    expect(await screen.findByText("4.5")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Rated 4.5 out of 5" })).toBeInTheDocument();
  });

  it("loads the year the reader picks", async () => {
    render(<StatsPage />);
    await waitFor(() => expect(getYearInReview).toHaveBeenCalled());

    await userEvent.selectOptions(yearPicker(), String(CURRENT_YEAR - 1));

    await waitFor(() => expect(getYearInReview).toHaveBeenCalledWith(CURRENT_YEAR - 1));
    expect(yearPicker().value).toBe(String(CURRENT_YEAR - 1));
  });
});

describe("StatsPage — a profile with no history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    getWatchStats.mockResolvedValue(noHistory);
    getDetailedStats.mockResolvedValue(detailed);
    getYearInReview.mockImplementation(async (year: number) => yearReview(year));
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <StatsPage />
      </MemoryRouter>
    );

  // Four zero tiles, a flat chart and "No badges earned yet" is a screen that
  // reads as broken. It is the expected state for a new profile, and the page
  // has to say so and point somewhere.
  it("explains the emptiness and offers a way out of it", async () => {
    renderPage();

    expect(await screen.findByText(/nothing watched yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /find something to watch/i })).toHaveAttribute("href", "/search");
  });

  it("shows none of the zeroed panels", async () => {
    renderPage();
    await screen.findByText(/nothing watched yet/i);

    expect(screen.queryByLabelText("Year in review: year")).not.toBeInTheDocument();
    expect(screen.queryByText(/no badges earned yet/i)).not.toBeInTheDocument();
  });

  // The empty state is about having watched nothing, not about the request
  // failing — a load error still has to report itself.
  it("reports a failed load instead", async () => {
    getWatchStats.mockRejectedValue(new Error("Stats unavailable"));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Stats unavailable");
    expect(screen.queryByText(/nothing watched yet/i)).not.toBeInTheDocument();
  });
});
