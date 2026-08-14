import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { SeriesProgress } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { resetDataCacheForTests } from "../utils/dataCache";
import { DashboardPage } from "./DashboardPage";

/*
 * "Mark next episode" and the timer behind its confirmation.
 *
 * The button holds a "Marked" state for 1.2 seconds and then reloads the
 * dashboard, so the work it schedules outlives the click by more than a
 * navigation takes: marking an episode and tapping through to Settings inside
 * that window used to fire the page's five requests for a page that had already
 * gone, and write their answers into the cache the next profile reads from.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getWatchStats: vi.fn(),
      getSeriesProgress: vi.fn(),
      getWatchHistory: vi.fn(),
      getCheckin: vi.fn(),
      getNowPlaying: vi.fn(),
      getDetailedStats: vi.fn(),
      getTrending: vi.fn(),
      getAiConfig: vi.fn(),
      getAiRecommendations: vi.fn(),
      getCalendar: vi.fn(),
      endCheckin: vi.fn(),
      markNextEpisodeWatched: vi.fn(),
    },
  };
});

vi.mock("../components/MediaDetailPanel", () => ({
  DetailPanel: () => null,
  useDetailPanel: () => ({
    selectedItem: null,
    setSelectedItem: vi.fn(),
    panelHistory: [],
    setPanelHistory: vi.fn(),
    panelHistoryLoading: false,
    detail: null,
    detailLoading: false,
  }),
}));

const { api, runtimeConfig } = await import("../api");
const getSeriesProgress = vi.mocked(api.getSeriesProgress);
const markNextEpisodeWatched = vi.mocked(api.markNextEpisodeWatched);

const severance: SeriesProgress = {
  imdbId: "tt11280740",
  name: "Severance",
  lastSeason: 1,
  lastEpisode: 3,
  nextSeason: 1,
  nextEpisode: 4,
};

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <DashboardPage />
      </ToastProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetDataCacheForTests();
  runtimeConfig.setProfileId("first-profile");
  getSeriesProgress.mockResolvedValue([severance]);
  vi.mocked(api.getWatchStats).mockResolvedValue({
    totalMovies: 0,
    totalEpisodes: 0,
    totalMinutes: 0,
  } as never);
  vi.mocked(api.getWatchHistory).mockResolvedValue([]);
  vi.mocked(api.getCheckin).mockResolvedValue({ checkin: null } as never);
  vi.mocked(api.getNowPlaying).mockResolvedValue({ sessions: [] } as never);
  vi.mocked(api.getDetailedStats).mockResolvedValue({
    monthly: [],
    genreDistribution: [],
    currentStreak: 0,
    longestStreak: 0,
    topRated: [],
  });
  vi.mocked(api.getTrending).mockResolvedValue({ metas: [] } as never);
  vi.mocked(api.getCalendar).mockResolvedValue({ calendar: [] } as never);
  vi.mocked(api.getAiConfig).mockResolvedValue({ configured: false, lastGeneratedAt: null } as never);
  markNextEpisodeWatched.mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Marks the next episode and lets the request settle, without running the timer. */
async function markNext() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(await screen.findByRole("button", { name: "Mark S1:E4" }));
  await act(async () => {});
}

describe("Dashboard mark-next confirmation timer", () => {
  it("reloads the dashboard when the confirmation expires", async () => {
    renderDashboard();
    await screen.findByRole("button", { name: "Mark S1:E4" });
    const beforeMark = getSeriesProgress.mock.calls.length;

    await markNext();
    // Still holding "Marked" — the reload is the timer's job, not the click's.
    expect(getSeriesProgress).toHaveBeenCalledTimes(beforeMark);

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });

    expect(getSeriesProgress.mock.calls.length).toBeGreaterThan(beforeMark);
  });

  it("does not reload after the page is gone", async () => {
    const { unmount } = renderDashboard();
    await screen.findByRole("button", { name: "Mark S1:E4" });

    await markNext();
    const beforeUnmount = getSeriesProgress.mock.calls.length;
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // The five requests this used to fire land on a page that no longer exists,
    // and are written to the cache under whichever profile is active by then.
    expect(getSeriesProgress).toHaveBeenCalledTimes(beforeUnmount);
  });

  it("does not arm the confirmation timer when the mark lands after the page is gone", async () => {
    // The other direction of the same leak: clearing the timers on unmount does
    // nothing about a request still in flight *at* unmount, whose continuation
    // arms a fresh timer after the cleanup that would have cleared it has run.
    let finishMark: () => void = () => {};
    markNextEpisodeWatched.mockImplementation(
      () => new Promise((resolve) => { finishMark = () => resolve(undefined as never); })
    );

    const { unmount } = renderDashboard();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Mark S1:E4" }));

    const beforeUnmount = getSeriesProgress.mock.calls.length;
    unmount();
    await act(async () => { finishMark(); });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(getSeriesProgress).toHaveBeenCalledTimes(beforeUnmount);
  });

  it("does not reload after the page is gone when the mark itself fails", async () => {
    // A failed mark reloads immediately rather than on a timer, from inside an
    // async handler that can resume just as late.
    let failMark: (error: Error) => void = () => {};
    markNextEpisodeWatched.mockImplementation(
      () => new Promise((_, reject) => { failMark = reject; })
    );

    const { unmount } = renderDashboard();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Mark S1:E4" }));

    const beforeUnmount = getSeriesProgress.mock.calls.length;
    unmount();
    await act(async () => {
      failMark(new Error("already fully watched"));
    });

    expect(getSeriesProgress).toHaveBeenCalledTimes(beforeUnmount);
  });
});
