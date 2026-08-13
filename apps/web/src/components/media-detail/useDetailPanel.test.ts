import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetailBundle, SearchResult } from "../../api";
import { resetDataCacheForTests, setCacheScope } from "../../utils/dataCache";

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      getDetailBundle: vi.fn(),
      getWatchHistory: vi.fn(),
    },
  };
});

const { api } = await import("../../api");
const { invalidateDetailBundle, useDetailPanel } = await import("./useDetailPanel");
const getDetailBundle = vi.mocked(api.getDetailBundle);
const getWatchHistory = vi.mocked(api.getWatchHistory);

const SERIES: SearchResult = {
  imdbId: "tt-severance",
  type: "series",
  name: "Severance",
  year: 2022,
  poster: null,
  description: null,
  genres: [],
  rating: null,
  inWatchlist: false,
  inCollection: false,
  lists: [],
};

const bundle = (dropped: boolean): DetailBundle => ({
  meta: {
    imdbId: SERIES.imdbId,
    type: "series",
    name: "Severance",
    year: 2022,
    poster: null,
    description: null,
    genres: [],
    rating: null,
    imdbRating: null,
    rtScore: null,
    mcScore: null,
    runtime: null,
    certification: null,
    status: null,
    network: null,
    releaseDate: null,
    tmdbId: null,
    background: null,
  },
  cast: [],
  director: null,
  providers: { link: null, flatrate: [], free: [], ads: [] },
  recommendations: [],
  seasons: [],
  dropped,
});

/** Mounts the hook, opens `SERIES`, and waits for the panel to settle. */
async function openSeries() {
  const view = renderHook(() => useDetailPanel());
  act(() => view.result.current.setSelectedItem(SERIES));
  await waitFor(() => expect(view.result.current.detail).not.toBeNull());
  return view;
}

// Each test claims its own scope, which both isolates it from the previous
// one's cache entries and stands in for the profile that is signed in.
let nextScope = 0;
const enterProfile = (id: string) => act(() => setCacheScope(`${id}#${(nextScope += 1)}`));

beforeEach(() => {
  getWatchHistory.mockResolvedValue([]);
  getDetailBundle.mockResolvedValue(bundle(false));
});

afterEach(() => {
  resetDataCacheForTests();
  vi.clearAllMocks();
});

describe("useDetailPanel bundle cache", () => {
  it("serves a reopen within the TTL without going back to the network", async () => {
    enterProfile("profile-a");

    const first = await openSeries();
    expect(getDetailBundle).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = await openSeries();
    expect(getDetailBundle).toHaveBeenCalledTimes(1);
    // And it lands in the first commit, not after a spinner.
    expect(second.result.current.detailLoading).toBe(false);
  });

  it("refetches after the bundle is invalidated by a mutation", async () => {
    enterProfile("profile-a");

    const first = await openSeries();
    first.unmount();

    act(() => invalidateDetailBundle(SERIES.imdbId));
    await openSeries();
    expect(getDetailBundle).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate a title whose id merely starts the same way", async () => {
    enterProfile("profile-a");

    const first = await openSeries();
    first.unmount();

    // `tt-severance` starts with `tt-sever`; only an exact id should clear it.
    act(() => invalidateDetailBundle("tt-sever"));
    await openSeries();
    expect(getDetailBundle).toHaveBeenCalledTimes(1);
  });

  // The bug: `DetailBundle.dropped` is per-profile state, and the cache was a
  // bare Map keyed on the title. Switching profiles inside the 60s TTL showed
  // the second profile the first's Dropped badge — with an Undrop button that
  // then wrote to the second profile's data.
  it("never shows one profile the dropped state cached by another", async () => {
    enterProfile("profile-a");
    getDetailBundle.mockResolvedValue(bundle(true));
    const asA = await openSeries();
    expect(asA.result.current.detail?.dropped).toBe(true);
    asA.unmount();

    enterProfile("profile-b");
    getDetailBundle.mockResolvedValue(bundle(false));
    const asB = await openSeries();

    expect(getDetailBundle).toHaveBeenCalledTimes(2);
    expect(asB.result.current.detail?.dropped).toBe(false);
  });

  it("discards a bundle that arrives after the profile has changed", async () => {
    enterProfile("profile-a");

    let resolveA: (bundle: DetailBundle) => void = () => {};
    getDetailBundle.mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve; }));
    const asA = renderHook(() => useDetailPanel());
    act(() => asA.result.current.setSelectedItem(SERIES));
    await waitFor(() => expect(getDetailBundle).toHaveBeenCalledTimes(1));

    // A's request is still in flight when the switch happens.
    asA.unmount();
    enterProfile("profile-b");
    await act(async () => { resolveA(bundle(true)); });

    getDetailBundle.mockResolvedValue(bundle(false));
    const asB = await openSeries();
    expect(getDetailBundle).toHaveBeenCalledTimes(2);
    expect(asB.result.current.detail?.dropped).toBe(false);
  });
});
