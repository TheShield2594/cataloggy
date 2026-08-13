import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import type { SearchResult } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { CommandPalette } from "./CommandPalette";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { search: vi.fn() } };
});

// Stubbed, but statefully: opening a result is the palette's job, and the real
// panel would go fetching a bundle, a check-in and a rating to prove it.
vi.mock("./MediaDetailPanel", async () => {
  const { useState } = await import("react");
  return {
    DetailPanel: ({ item, onClose }: { item: SearchResult; onClose: () => void }) => (
      <div>
        <p>Detail panel: {item.name}</p>
        <button type="button" onClick={onClose}>close panel</button>
      </div>
    ),
    useDetailPanel: () => {
      const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
      return {
        selectedItem,
        setSelectedItem,
        panelHistory: [],
        setPanelHistory: () => {},
        panelHistoryLoading: false,
        detail: null,
        detailLoading: false,
      };
    },
  };
});

const { api } = await import("../api");
const search = vi.mocked(api.search);

function result(name: string, type: "movie" | "series" = "movie"): SearchResult {
  return {
    imdbId: `tt-${name.toLowerCase()}`,
    type,
    name,
    year: 2001,
    poster: null,
    description: null,
    genres: [],
    rating: null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname + location.search}</p>;
}

function renderPalette(open = true) {
  const onClose = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={["/"]}>
      <ToastProvider>
        <CommandPalette open={open} onClose={onClose} />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  );
  return { ...view, onClose };
}

const path = () => screen.getByTestId("path").textContent;

beforeEach(() => {
  search.mockResolvedValue([]);
});

describe("CommandPalette", () => {
  it("renders nothing until it is opened", () => {
    renderPalette(false);

    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("takes focus on open, so typing goes to the palette", async () => {
    renderPalette();

    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());
  });

  it("runs the highlighted action on Enter, having arrowed down to it", async () => {
    const user = userEvent.setup();
    renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    // Dashboard, Search, Lists — the third action down.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(path()).toBe("/lists"));
  });

  it("stops at the first row rather than wrapping past the top", async () => {
    const user = userEvent.setup();
    renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    await user.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}{Enter}");

    await waitFor(() => expect(path()).toBe("/"));
  });

  it("filters the actions as you type", async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "settings");

    expect(screen.getByRole("option", { name: /go to settings/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go to lists/i })).not.toBeInTheDocument();
  });

  it("opens a title from the results without leaving the page", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await user.click(await screen.findByRole("option", { name: /Solaris/ }));

    expect(await screen.findByText("Detail panel: Solaris")).toBeInTheDocument();
    expect(path()).toBe("/");
  });

  it("hands the palette back when that panel closes, query intact", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await user.click(await screen.findByRole("option", { name: /Solaris/ }));
    await user.click(screen.getByRole("button", { name: "close panel" }));

    expect(await screen.findByLabelText("Search everything")).toHaveValue("sol");
    expect(screen.getByRole("option", { name: /Solaris/ })).toBeInTheDocument();
  });

  it("Enter on the highlighted title opens it rather than running an action", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await screen.findByRole("option", { name: /Solaris/ });
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Detail panel: Solaris")).toBeInTheDocument();
  });

  // Arrow keys move a highlight that decides what Enter does, while focus stays
  // in the input so typing keeps working. Which means the highlight has to be
  // published as `aria-activedescendant` — a background colour is not a state.
  it("publishes the highlighted row, not just its background", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    // "se" so the list holds the title *and* the actions it matches — with a
    // single option there is nowhere for ArrowDown to go.
    await user.type(input, "se");
    const solaris = await screen.findByRole("option", { name: /Solaris/ });

    expect(input).toHaveAttribute("role", "combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(solaris).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", solaris.id);

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(solaris).toHaveAttribute("aria-selected", "false");
      expect(input.getAttribute("aria-activedescendant")).not.toBe(solaris.id);
    });
    // The options are reached through the input, so none of them is a tab stop.
    for (const option of screen.getAllByRole("option")) {
      expect(option).toHaveAttribute("tabindex", "-1");
    }
  });

  // Whatever aria-activedescendant names has to be in the document. Two ways it
  // could stop being: a search that leaves the previous titles in state while it
  // runs (the title rows come off screen, but the row count they contributed
  // doesn't), and a list that empties under a highlight the arrow keys have
  // already moved.
  const activeDescendantIsRendered = (input: HTMLElement) => {
    const id = input.getAttribute("aria-activedescendant");
    if (id === null) return;
    const target = document.getElementById(id);
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute("role", "option");
  };

  it("never points at a row that isn't rendered", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    await user.type(input, "se");
    await screen.findByRole("option", { name: /Solaris/ });
    activeDescendantIsRendered(input);

    // A second search, held open. The Solaris row is gone from the screen while
    // it runs, but it is still in `results`. One shared promise, so releasing it
    // settles every call the debounce made rather than only the last.
    let release: () => void = () => {};
    const pending = new Promise<SearchResult[]>((r) => { release = () => r([]); });
    search.mockImplementation((type) => (type === "movie" ? pending : Promise.resolve([])));
    await user.type(input, "a");

    // The visible line spells it with three dots; the live region uses an
    // ellipsis, so an exact string picks out the one on screen.
    await waitFor(() => {
      expect(screen.getByText("Searching...")).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Solaris/ })).not.toBeInTheDocument();
    });
    activeDescendantIsRendered(input);

    await user.keyboard("{ArrowDown}");
    activeDescendantIsRendered(input);

    release();
    await waitFor(() => expect(screen.queryByText("Searching...")).not.toBeInTheDocument());
    activeDescendantIsRendered(input);
  });

  it("points at nothing when there are no options to point at", async () => {
    const user = userEvent.setup();
    search.mockResolvedValue([]);
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    // A query no title and no action label matches, so the listbox is empty.
    await user.type(input, "zzzz");

    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{ArrowDown}");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    activeDescendantIsRendered(input);
  });

  it("says search is unavailable instead of reporting no matches", async () => {
    const user = userEvent.setup();
    search.mockRejectedValue(new Error("TMDB is not configured"));
    renderPalette();

    await user.type(screen.getByLabelText("Search everything"), "sol");

    expect(await screen.findByText(/search is unavailable right now/i)).toBeInTheDocument();
  });

  /*
   * The debounce only ever cancelled the timer, which does nothing about a
   * request already on the wire — so whichever round trip finished last won,
   * and typing "dun" then "dune" could leave the results for "dun" sitting
   * under the query "dune".
   */
  it("shows the newest query's results even when an older search lands last", async () => {
    const user = userEvent.setup();
    let releaseStale: () => void = () => {};
    const stale = new Promise<SearchResult[]>((r) => {
      releaseStale = () => r([result("Dungeon")]);
    });
    search.mockImplementation((type, query) => {
      if (query === "dune") return Promise.resolve(type === "movie" ? [result("Dune")] : []);
      return type === "movie" ? stale : Promise.resolve([]);
    });
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    await user.type(input, "dun");
    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "dun", expect.any(AbortSignal)));
    await user.type(input, "e");
    expect(await screen.findByRole("option", { name: /Dune/ })).toBeInTheDocument();

    // The abandoned search finally answers. The mocked `api.search` ignores the
    // abort, which is the point: the request id has to be what keeps it out,
    // since a response already in flight when the signal fires still arrives.
    await act(async () => {
      releaseStale();
    });

    expect(screen.queryByRole("option", { name: /Dungeon/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Dune/ })).toBeInTheDocument();
  });

  // The spinner belongs to the live search, so a superseded one clearing it
  // would report a finished search that is still running.
  it("keeps the spinner up when the search it replaced finishes", async () => {
    const user = userEvent.setup();
    let releaseStale: () => void = () => {};
    const stale = new Promise<SearchResult[]>((r) => { releaseStale = () => r([]); });
    const neverSettles = new Promise<SearchResult[]>(() => {});
    search.mockImplementation((_type, query) => (query === "dune" ? neverSettles : stale));
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    await user.type(input, "dun");
    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "dun", expect.any(AbortSignal)));
    await user.type(input, "e");
    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "dune", expect.any(AbortSignal)));

    await act(async () => {
      releaseStale();
    });

    expect(screen.getByText("Searching...")).toBeInTheDocument();
  });

  // Emptying the box takes the effect's early return, which schedules no timer
  // — so the cleanup is the only thing standing between a request already in
  // flight and a set of results rendered under a query that is no longer there.
  it("shows nothing when the query is cleared out from under a running search", async () => {
    const user = userEvent.setup();
    let releaseAbandoned: () => void = () => {};
    const abandoned = new Promise<SearchResult[]>((r) => {
      releaseAbandoned = () => r([result("Solaris")]);
    });
    search.mockImplementation((type) => (type === "movie" ? abandoned : Promise.resolve([])));
    renderPalette();

    const input = screen.getByLabelText("Search everything");
    await user.type(input, "sol");
    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "sol", expect.any(AbortSignal)));
    await user.clear(input);

    await act(async () => {
      releaseAbandoned();
    });

    expect(screen.queryByRole("option", { name: /Solaris/ })).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("gives up the request when the palette closes", async () => {
    const user = userEvent.setup();
    const signals: AbortSignal[] = [];
    search.mockImplementation((_type, _query, signal) => {
      if (signal) signals.push(signal);
      return new Promise<SearchResult[]>(() => {});
    });
    const onClose = vi.fn();
    const palette = (open: boolean) => (
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <CommandPalette open={open} onClose={onClose} />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    );
    const { rerender } = render(palette(true));

    await user.type(screen.getByLabelText("Search everything"), "sol");
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    expect(signals.every((s) => !s.aborted)).toBe(true);

    // The palette stays mounted when it closes, so nothing else would stop it.
    rerender(palette(false));

    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();
    await waitFor(() => expect(screen.getByLabelText("Search everything")).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("opens on a clean slate the next time", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <CommandPalette open onClose={onClose} />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    );
    await user.type(screen.getByLabelText("Search everything"), "sol");

    const palette = (open: boolean) => (
      <MemoryRouter initialEntries={["/"]}>
        <ToastProvider>
          <CommandPalette open={open} onClose={onClose} />
          <LocationProbe />
        </ToastProvider>
      </MemoryRouter>
    );
    rerender(palette(false));
    rerender(palette(true));

    expect(await screen.findByLabelText("Search everything")).toHaveValue("");
  });
});
