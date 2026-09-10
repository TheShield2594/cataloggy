/**
 * What happens to an optimistic tick when the write behind it never lands.
 *
 * A watch marked with no connection is held by the service worker and the
 * episode is ticked straight away, because that is what the user asked for and
 * what will be true. If the server later refuses the write, the tick is a claim
 * nothing supports — and it lives in this component's own state, where dropping
 * the API cache cannot reach it. `WATCH_STATE_STALE_EVENT` is what closes that
 * gap; without it the refusal was reported in a toast while the screen behind it
 * went on saying "watched" until the panel was closed and reopened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineWriteQueuedError, WATCH_STATE_STALE_EVENT } from "../../api";
import { SeasonsSection } from "./SeasonsSection";

const getWatchedEpisodes = vi.fn();
const markEpisodeWatched = vi.fn();

vi.mock("../../api", async (importOriginal) => {
  // The error class is the real one: the component branches on `instanceof`.
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      getWatchedEpisodes: (...args: unknown[]) => getWatchedEpisodes(...args),
      markEpisodeWatched: (...args: unknown[]) => markEpisodeWatched(...args),
      getTitleRatings: async () => ({ ratings: [] }),
      getSeasonEpisodes: async () => ({
        episodes: [
          { episodeNumber: 1, name: "Good News About Hell", runtime: 47, airDate: "2022-02-18" },
        ],
      }),
    },
  };
});

const SEASONS = [
  { seasonNumber: 1, name: "Season 1", episodeCount: 1, airYear: 2022, poster: null },
];

/** The episode's circle. Its label leads with Mark or Unmark as it flips. */
const episodeToggle = () => screen.getByRole("button", { name: /Good News About Hell watched$/ });

beforeEach(() => {
  getWatchedEpisodes.mockResolvedValue({ episodes: [] });
  markEpisodeWatched.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an offline tick the server later refuses", () => {
  it("is ticked while the worker holds it, then unticked when the refusal comes back", async () => {
    const user = userEvent.setup();
    markEpisodeWatched.mockRejectedValue(new OfflineWriteQueuedError());
    const onToast = vi.fn();
    render(<SeasonsSection imdbId="tt1" seasons={SEASONS} loading={false} onToast={onToast} />);

    // No clicking to expand: the panel opens the season you are in, which with
    // nothing watched is the first one.
    await user.click(await screen.findByRole("button", { name: /Mark .* watched$/ }));

    // Held, not failed: the episode reads as watched and the copy says why.
    await waitFor(() => expect(episodeToggle()).toHaveAttribute("aria-pressed", "true"));
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Saved offline"), "info");

    // The write reached the API on reconnect and the API said no. The server's
    // answer is now the truth, and it does not have this episode.
    getWatchedEpisodes.mockResolvedValue({ episodes: [] });
    act(() => {
      window.dispatchEvent(new Event(WATCH_STATE_STALE_EVENT));
    });

    await waitFor(() => expect(episodeToggle()).toHaveAttribute("aria-pressed", "false"));
  });

  it("keeps the tick when the server confirms the write did land", async () => {
    // The same event fires for every consumer, so it has to be able to say
    // "yes, that one is real" as well as taking a tick away.
    const user = userEvent.setup();
    markEpisodeWatched.mockRejectedValue(new OfflineWriteQueuedError());
    render(<SeasonsSection imdbId="tt1" seasons={SEASONS} loading={false} />);

    await user.click(await screen.findByRole("button", { name: /Mark .* watched$/ }));
    await waitFor(() => expect(episodeToggle()).toHaveAttribute("aria-pressed", "true"));

    getWatchedEpisodes.mockResolvedValue({ episodes: [{ season: 1, episode: 1 }] });
    act(() => {
      window.dispatchEvent(new Event(WATCH_STATE_STALE_EVENT));
    });

    await waitFor(() => expect(getWatchedEpisodes).toHaveBeenCalledTimes(2));
    expect(episodeToggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves the last answer alone when the re-read itself fails", async () => {
    // Unlike the first load, there is a previous answer here, and it is closer
    // to the truth than an empty set.
    const user = userEvent.setup();
    markEpisodeWatched.mockRejectedValue(new OfflineWriteQueuedError());
    render(<SeasonsSection imdbId="tt1" seasons={SEASONS} loading={false} />);

    await user.click(await screen.findByRole("button", { name: /Mark .* watched$/ }));
    await waitFor(() => expect(episodeToggle()).toHaveAttribute("aria-pressed", "true"));

    getWatchedEpisodes.mockRejectedValue(new Error("still offline"));
    act(() => {
      window.dispatchEvent(new Event(WATCH_STATE_STALE_EVENT));
    });

    await waitFor(() => expect(getWatchedEpisodes).toHaveBeenCalledTimes(2));
    expect(episodeToggle()).toHaveAttribute("aria-pressed", "true");
  });
});
