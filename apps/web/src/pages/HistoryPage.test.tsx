import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { WatchEvent } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { readCache, resetDataCacheForTests } from "../utils/dataCache";
import { HistoryPage } from "./HistoryPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getWatchHistory: vi.fn(),
      deleteWatchEvent: vi.fn(),
      updateWatchEventNote: vi.fn(),
      logWatch: vi.fn(),
    },
  };
});

// The panel fetches metadata and history of its own the moment a row opens;
// none of that is what this file is about. The setter is hoisted so a case can
// assert that a row did *not* open it.
const setSelectedItem = vi.hoisted(() => vi.fn());

vi.mock("../components/MediaDetailPanel", () => ({
  DetailPanel: () => null,
  useDetailPanel: () => ({
    selectedItem: null,
    setSelectedItem,
    panelHistory: [],
    setPanelHistory: vi.fn(),
    panelHistoryLoading: false,
  }),
}));

const { api } = await import("../api");
const getWatchHistory = vi.mocked(api.getWatchHistory);
const deleteWatchEvent = vi.mocked(api.deleteWatchEvent);
const updateWatchEventNote = vi.mocked(api.updateWatchEventNote);

function watched(name: string, over: Partial<WatchEvent> = {}): WatchEvent {
  return {
    id: `ev-${name.toLowerCase()}`,
    imdbId: `tt-${name.toLowerCase()}`,
    type: "movie",
    name,
    watchedAt: new Date().toISOString(),
    dateUnknown: false,
    note: null,
    ...over,
  };
}

const ALIEN = watched("Alien");
const SOLARIS = watched("Solaris", { note: "Rewatch — still holds up" });
const EPISODE = watched("Twin Peaks", { type: "episode", season: 2, episode: 7 });

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <HistoryPage />
      </ToastProvider>
    </MemoryRouter>
  );
}

// The cache outlives a mount by design — that is what it is for — so it has to
// be cleared between cases, or one case's history is the next one's first paint.
beforeEach(() => {
  resetDataCacheForTests();
  getWatchHistory.mockResolvedValue([ALIEN, SOLARIS]);
  // jsdom has no viewport, so the infinite-scroll sentinel never intersects on
  // its own — which is what these cases want: one page, loaded once.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe("HistoryPage", () => {
  it("asks the server for the filtered type rather than filtering the loaded page", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: "Episodes" }));

    await waitFor(() =>
      expect(getWatchHistory).toHaveBeenLastCalledWith(25, 0, {
        type: "episode",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("keeps the filter pills reachable when the fetch fails", async () => {
    getWatchHistory.mockRejectedValue(new Error("Network down"));
    renderPage();

    expect(await screen.findByText("Network down")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Movies" })).toBeInTheDocument();
  });

  // A button inside a button has no defined accessible mapping, and assistive
  // tech resolves it differently from one implementation to the next — the row
  // was a role="button" wrapping the note and delete controls. All three are
  // still here; none of them contains another.
  it("keeps the row's three controls as siblings, not nested buttons", async () => {
    renderPage();
    await screen.findByText("Alien");

    const open = screen.getByRole("button", { name: /view details for alien/i });
    const note = screen.getByRole("button", { name: /add note to alien/i });
    const remove = screen.getByRole("button", { name: /delete watch of alien/i });

    for (const [a, b] of [[open, note], [open, remove], [note, remove]]) {
      expect(a.contains(b)).toBe(false);
      expect(b.contains(a)).toBe(false);
    }
  });

  it("removes a row optimistically and offers the way back", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockResolvedValue(undefined as never);
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getAllByRole("button", { name: /delete watch of alien/i })[0]);

    await waitFor(() => expect(screen.queryByText("Alien")).not.toBeInTheDocument());
    expect(await screen.findByText(/Removed Alien from history/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  // The row's controls used to sit inside a role="button" that swallowed Enter
  // and Space, so a keystroke bubbling up from one of them was cancelled there
  // and the detail panel opened where a keyboard user had asked to delete. The
  // row-opening control is a sibling of these two now, not their ancestor —
  // which is also what stops the pair reading as a button inside a button.
  it("deletes from the keyboard rather than opening the panel", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockResolvedValue(undefined as never);
    renderPage();
    await screen.findByText("Alien");

    screen.getAllByRole("button", { name: /delete watch of alien/i })[0].focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(deleteWatchEvent).toHaveBeenCalledWith(ALIEN.id));
    expect(setSelectedItem).not.toHaveBeenCalled();
  });

  it("opens the note editor from the keyboard, on Space as well", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alien");

    screen.getByRole("button", { name: /add note to alien/i }).focus();
    await user.keyboard(" ");

    expect(await screen.findByLabelText(/^note on alien$/i)).toBeInTheDocument();
    expect(setSelectedItem).not.toHaveBeenCalled();
  });

  it("puts a row back when the delete fails", async () => {
    const user = userEvent.setup();
    deleteWatchEvent.mockRejectedValue(new Error("Server said no"));
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getAllByRole("button", { name: /delete watch of alien/i })[0]);

    expect(await screen.findByText("Server said no")).toBeInTheDocument();
    expect(screen.getByText("Alien")).toBeInTheDocument();
  });
});

describe("HistoryPage caching and pagination", () => {
  const byFilter = async (
    _limit: number,
    _offset: number,
    opts?: { type?: "movie" | "episode" }
  ) => (opts?.type === "movie" ? [ALIEN] : [ALIEN, EPISODE]);

  /**
   * Replaces the inert observer from `beforeEach` with one the case drives:
   * jsdom lays nothing out, so the sentinel never intersects on its own.
   * Returns the trigger, which always fires the newest observer — the effect
   * builds a fresh one each time the list it is watching changes.
   */
  function observeScrollSentinel() {
    let fire: () => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          fire = () => callback([{ isIntersecting: true }]);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    return () => fire();
  }

  // An episode row writes its title and its S2E7 in separate elements, so the
  // row's accessible name is what names one whole row.
  const findEpisode = () => screen.findByRole("button", { name: "View details for Twin Peaks S2E7" });
  const episodeRow = () => screen.queryByRole("button", { name: "View details for Twin Peaks S2E7" });

  /*
   * The cache key has to carry the filter, because the filter is half the
   * question the server answered. Keyed on a constant, a movies-only page was
   * stored as though it were the whole history — and the next mount, which
   * starts at "All", read it back and painted it as complete.
   *
   * Asserted against the cache rather than the screen: what goes wrong is what
   * gets written, and the page it poisons is the next mount, not this one.
   */
  it("stores a filtered page under a key of its own", async () => {
    const user = userEvent.setup();
    getWatchHistory.mockImplementation(byFilter as never);
    renderPage();
    await findEpisode();

    await user.click(screen.getByRole("button", { name: "Movies" }));
    await waitFor(() => expect(episodeRow()).not.toBeInTheDocument());

    expect(readCache("history:events:movie")).toEqual([ALIEN]);
    // Untouched: still the whole history, which is what the next mount opens on.
    expect(readCache("history:events:all")).toEqual([ALIEN, EPISODE]);
  });

  /*
   * Infinite scroll fires near the bottom; the user taps a filter before the
   * page lands. Appending it would put a page of the old result set under the
   * new one's heading — and leave the next page starting from the wrong row.
   */
  it("drops an in-flight page when the filter changes under it", async () => {
    const user = userEvent.setup();
    const intersect = observeScrollSentinel();

    // A full page, so the list reports more to come and the sentinel is live.
    const firstPage = Array.from({ length: 25 }, (_, i) => watched(`Feature ${i}`));
    let releaseSecondPage: () => void = () => {};
    const secondPage = new Promise<WatchEvent[]>((r) => {
      releaseSecondPage = () => r([watched("Late Arrival")]);
    });
    getWatchHistory.mockImplementation((async (
      _limit: number,
      offset: number,
      opts?: { type?: "movie" | "episode" }
    ) => {
      if (opts?.type === "episode") return [EPISODE];
      return offset === 0 ? firstPage : secondPage;
    }) as never);
    renderPage();
    await screen.findByText("Feature 0");

    await act(async () => {
      intersect();
    });
    await waitFor(() => expect(getWatchHistory).toHaveBeenLastCalledWith(25, 25, expect.anything()));
    await user.click(screen.getByRole("button", { name: "Episodes" }));
    await findEpisode();

    await act(async () => {
      releaseSecondPage();
    });

    expect(screen.queryByText("Late Arrival")).not.toBeInTheDocument();
    expect(screen.queryByText("Feature 0")).not.toBeInTheDocument();
  });

  /*
   * A delete removes the row here and on the server at once, so every offset
   * past it moves — including the one a page already in flight was asking for.
   * Tracking the offset separately and nudging it by ±1 compensated for the
   * shift *next* time and left the page in flight reading the old numbering, so
   * the row that moved into its place was never fetched by anyone.
   *
   * The history the server holds is modelled here, because that skipped row is
   * the whole defect and a fixed mock response cannot show it.
   */
  it("skips no row when a delete lands while a page is in flight", async () => {
    const user = userEvent.setup();
    const intersect = observeScrollSentinel();

    const server = Array.from({ length: 40 }, (_, i) => watched(`Feature ${i}`));
    let releasePage: () => void = () => {};
    let pending: Promise<WatchEvent[]> | null = null;
    getWatchHistory.mockImplementation((async (limit: number, offset: number) => {
      if (offset === 0) return server.slice(0, limit);
      // Held open, and answered from the list as it stands when it is released —
      // a read the server runs after the delete has already gone through.
      pending = new Promise<WatchEvent[]>((r) => {
        releasePage = () => r(server.slice(offset, offset + limit));
      });
      return pending;
    }) as never);
    deleteWatchEvent.mockImplementation((async (id: string) => {
      server.splice(server.findIndex((e) => e.id === id), 1);
    }) as never);
    renderPage();
    await screen.findByText("Feature 0");

    await act(async () => {
      intersect();
    });
    await user.click(screen.getAllByRole("button", { name: /delete watch of feature 0/i })[0]);
    await waitFor(() => expect(screen.queryByText("Feature 0")).not.toBeInTheDocument());
    await act(async () => {
      releasePage();
    });
    // The scroll sentinel is still at the bottom of a list that is one row
    // shorter than it was, so the page it asks for next is the one that counts.
    await act(async () => {
      intersect();
    });
    await act(async () => {
      releasePage();
    });
    await screen.findByText("Feature 25");

    // Feature 24 was the last row of the first page; 25 is the one the stale
    // offset used to jump over, since deleting Feature 0 moved it into 24's place.
    for (const name of ["Feature 24", "Feature 25", "Feature 26"]) {
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
  });
});

describe("HistoryPage notes", () => {
  it("shows a note that came with the event", async () => {
    renderPage();

    expect(await screen.findByText("Rewatch — still holds up")).toBeInTheDocument();
  });

  it("adds a note to a watch that had none", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockResolvedValue({ watchEvent: watched("Alien", { note: "Saw it at the BFI" }) });
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Saw it at the BFI");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Saw it at the BFI")).toBeInTheDocument();
    expect(updateWatchEventNote).toHaveBeenCalledWith(ALIEN.id, "Saw it at the BFI");
    expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
  });

  it("clears a note when the field is emptied, rather than saving a blank one", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockResolvedValue({ watchEvent: watched("Solaris", { note: null }) });
    renderPage();
    await screen.findByText("Rewatch — still holds up");

    await user.click(screen.getByRole("button", { name: /edit note on solaris/i }));
    await user.clear(screen.getByLabelText(/^note on solaris$/i));
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(updateWatchEventNote).toHaveBeenCalledWith(SOLARIS.id, null);
    await waitFor(() =>
      expect(screen.queryByText("Rewatch — still holds up")).not.toBeInTheDocument()
    );
  });

  // A failed save that closed the editor would cost the user everything they
  // typed, and the row would go on showing the old note as if nothing happened.
  it("keeps the draft open when the save fails", async () => {
    const user = userEvent.setup();
    updateWatchEventNote.mockRejectedValue(new Error("Save failed"));
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Half-written thought");
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByLabelText(/^note on alien$/i)).toHaveValue("Half-written thought");
  });

  it("doesn't call the server when nothing changed", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Rewatch — still holds up");

    await user.click(screen.getByRole("button", { name: /edit note on solaris/i }));
    await user.click(screen.getByRole("button", { name: /save note/i }));

    expect(updateWatchEventNote).not.toHaveBeenCalled();
    expect(screen.getByText("Rewatch — still holds up")).toBeInTheDocument();
  });

  it("discards the draft on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Alien");

    await user.click(screen.getByRole("button", { name: /add note to alien/i }));
    await user.type(screen.getByLabelText(/^note on alien$/i), "Never mind{Escape}");

    expect(screen.queryByLabelText(/^note on alien$/i)).not.toBeInTheDocument();
    expect(updateWatchEventNote).not.toHaveBeenCalled();
  });
});
