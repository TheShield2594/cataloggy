import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { CatalogList, SearchResult } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { SearchPage } from "./SearchPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getLists: vi.fn(),
      search: vi.fn(),
      addToList: vi.fn(),
      createList: vi.fn(),
      getWatchProviders: vi.fn(),
    },
  };
});

// The panel fetches metadata and history of its own the moment a card opens;
// none of that is what this file is about.
vi.mock("../components/MediaDetailPanel", () => ({
  DetailPanel: () => null,
  useDetailPanel: () => ({
    selectedItem: null,
    setSelectedItem: vi.fn(),
    panelHistory: [],
    setPanelHistory: vi.fn(),
    panelHistoryLoading: false,
  }),
}));

const { api } = await import("../api");
const getLists = vi.mocked(api.getLists);
const search = vi.mocked(api.search);
const addToList = vi.mocked(api.addToList);
const createList = vi.mocked(api.createList);

const WATCHLIST: CatalogList = { id: "l-watch", name: "Watchlist", kind: "watchlist", itemCount: 3 };
const SCIFI: CatalogList = { id: "l-scifi", name: "Sci-Fi Night", kind: "custom", itemCount: 1 };

function result(name: string, over: Partial<SearchResult> = {}): SearchResult {
  return {
    imdbId: `tt-${name.toLowerCase().replace(/\s+/g, "-")}`,
    type: "movie",
    name,
    year: 2001,
    poster: null,
    description: null,
    genres: [],
    rating: null,
    inWatchlist: false,
    inCollection: false,
    lists: [],
    ...over,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="search-params">{location.search}</p>;
}

function renderPage(initialEntry = "/search") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/search"
            element={
              <>
                <SearchPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/settings" element={<p>settings page</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const queryField = () => screen.getByLabelText("Search movies and TV shows");

beforeEach(() => {
  getLists.mockResolvedValue({ lists: [WATCHLIST, SCIFI] });
  search.mockResolvedValue([]);
  addToList.mockResolvedValue(undefined as never);
  // The "where to watch" badges fetch when their card scrolls into view. jsdom
  // has no viewport, and a stub that never reports an intersection keeps that
  // network call out of every case here.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

describe("SearchPage query handling", () => {
  it("searches once for a query typed a letter at a time", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(queryField(), "alien");

    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "alien", expect.any(AbortSignal)));
    // Both types, because the filter starts on All — and nothing for the four
    // prefixes typed on the way there.
    expect(search).toHaveBeenCalledWith("series", "alien", expect.any(AbortSignal));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("searches only the chosen type once the filter narrows", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=alien");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    search.mockClear();

    await user.click(screen.getByRole("button", { name: "Movies" }));

    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "alien", expect.any(AbortSignal)));
    expect(search).not.toHaveBeenCalledWith("series", "alien", expect.any(AbortSignal));
  });

  it("keeps the query in the URL, so a search survives a reload or a share", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(queryField(), "solaris");

    await waitFor(() => expect(screen.getByTestId("search-params").textContent).toBe("?q=solaris"));
  });

  it("shows the invitation before anything has been searched", () => {
    renderPage();

    expect(screen.getByText(/discover your next favorite/i)).toBeInTheDocument();
    expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
  });

  it("returns to that invitation when the query is cleared", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPage("/search?q=solaris");
    expect(await screen.findByText("Solaris")).toBeInTheDocument();

    await user.clear(queryField());

    await waitFor(() => expect(screen.queryByText("Solaris")).not.toBeInTheDocument());
    expect(screen.getByText(/discover your next favorite/i)).toBeInTheDocument();
  });

  it("says no results rather than leaving the grid empty", async () => {
    renderPage("/search?q=nothing at all");

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
  });

  // The results swap under you as you type, and nothing moves focus when they
  // do. Without a live region the outcome of a search is only discoverable by
  // going to look for it.
  it("announces the outcome of a search, not just the grid", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    renderPage("/search?q=solaris");
    expect(await screen.findByText("Solaris")).toBeInTheDocument();

    const live = screen.getByRole("status", { name: /search status/i });
    expect(live).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(live).toHaveTextContent(/showing 1 match/i));

    // Still the same region afterwards — one that unmounts announces nothing.
    search.mockResolvedValue([]);
    await user.type(queryField(), "zzz");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: /search status/i })).toHaveTextContent(/nothing matched/i)
    );
  });

  it("names the missing TMDB key instead of blaming the search term", async () => {
    search.mockRejectedValue(new Error("TMDB API key is not configured"));
    renderPage("/search?q=alien");

    expect(await screen.findByText(/search needs a tmdb api key/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set up tmdb in settings/i })).toHaveAttribute(
      "href",
      "/settings?tab=integrations"
    );
  });

  it("reports any other failure as a failure, not as an empty result set", async () => {
    search.mockRejectedValue(new Error("Network down"));
    renderPage("/search?q=alien");

    // The toast fades; the page underneath has to keep saying what happened,
    // rather than settling into "no results" for a search that never ran.
    expect(await screen.findByText(/search failed/i)).toBeInTheDocument();
    expect(screen.getAllByText("Network down").length).toBeGreaterThan(0);
    expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tmdb api key/i)).not.toBeInTheDocument();
  });

  it("goes back to offering the filters once a later search succeeds", async () => {
    const user = userEvent.setup();
    search.mockRejectedValue(new Error("Network down"));
    renderPage("/search?q=alien");
    await screen.findByText(/search failed/i);

    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    await user.type(queryField(), "s");

    expect(await screen.findByText("Solaris")).toBeInTheDocument();
    expect(screen.queryByText(/search failed/i)).not.toBeInTheDocument();
  });

  it("ignores a slow search that lands after a newer one", async () => {
    const user = userEvent.setup();
    let releaseStale: () => void = () => {};
    const stalePending = new Promise<void>((resolve) => { releaseStale = resolve; });
    search
      .mockImplementationOnce(async () => { await stalePending; return [result("Stale Movie")]; })
      .mockImplementationOnce(async () => { await stalePending; return []; });

    renderPage("/search?q=alien");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
    await user.type(queryField(), "s");
    expect(await screen.findByText("Solaris")).toBeInTheDocument();

    releaseStale();
    await stalePending;
    await waitFor(() => expect(screen.getByText("Solaris")).toBeInTheDocument());
    expect(screen.queryByText("Stale Movie")).not.toBeInTheDocument();
  });
});

describe("SearchPage filters", () => {
  const HITS = [
    result("Solaris", { genres: ["Sci-Fi"], year: 1972, rating: 8.1 }),
    result("Sunshine", { genres: ["Sci-Fi", "Thriller"], year: 2007, rating: 7.2 }),
    result("Alien", { genres: ["Horror"], year: 1979, rating: 8.5 }),
  ];

  beforeEach(() => {
    search.mockImplementation(async (type) => (type === "movie" ? HITS : []));
  });

  it("filters the loaded results by genre and says what was filtered out", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=sci");
    expect(await screen.findByText("Alien")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.selectOptions(screen.getByLabelText("Genre"), "Sci-Fi");

    await waitFor(() => expect(screen.queryByText("Alien")).not.toBeInTheDocument());
    expect(screen.getByText(/2 results/)).toBeInTheDocument();
    expect(screen.getByText(/filtered from 3/)).toBeInTheDocument();
    // Narrowing the result set doesn't re-ask the server: it is the same search.
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("filters by year range and minimum rating", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=sci");
    expect(await screen.findByText("Sunshine")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText("Minimum year"), "1975");

    await waitFor(() => expect(screen.queryByText("Solaris")).not.toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Min Rating"), "8");

    await waitFor(() => expect(screen.queryByText("Sunshine")).not.toBeInTheDocument());
    expect(screen.getByText("Alien")).toBeInTheDocument();
  });

  it("sorts without dropping anything", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=sci");
    expect(await screen.findByText("Alien")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Title A–Z" }));

    await waitFor(() => {
      const titles = screen.getAllByRole("button", { name: /^View details for/ }).map((el) =>
        el.getAttribute("aria-label")?.replace("View details for ", "")
      );
      expect(titles).toEqual(["Alien", "Solaris", "Sunshine"]);
    });
  });

  it("clears the filters without clearing the search", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=sci&genre=Horror");
    expect(await screen.findByText("Alien")).toBeInTheDocument();
    expect(screen.queryByText("Solaris")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(await screen.findByText("Solaris")).toBeInTheDocument();
    expect(screen.getByTestId("search-params").textContent).toBe("?q=sci");
  });

  it("offers a way out when the filters, not the query, emptied the page", async () => {
    const user = userEvent.setup();
    renderPage("/search?q=sci&genre=Western");

    expect(await screen.findByText(/no results found/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /clear all filters/i }));

    expect(await screen.findByText("Alien")).toBeInTheDocument();
  });
});

describe("SearchPage list membership", () => {
  beforeEach(() => {
    search.mockImplementation(async (type) => (type === "movie" ? [result("Solaris")] : []));
  });

  const openAddMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage("/search?q=solaris");
    await screen.findByText("Solaris");
    await user.click(screen.getByRole("button", { name: "Add Solaris to a list" }));
    return within(screen.getByRole("group", { name: "Add Solaris to a list" }));
  };

  it("adds to the chosen list and shows the membership on the card", async () => {
    const user = userEvent.setup();
    const menu = await openAddMenu(user);

    await user.click(menu.getByRole("button", { name: "Sci-Fi Night" }));

    expect(addToList).toHaveBeenCalledWith(SCIFI.id, {
      type: "movie",
      imdbId: "tt-solaris",
      title: "Solaris",
    });
    expect(await screen.findByText(/Added "Solaris" to Sci-Fi Night/)).toBeInTheDocument();
    expect(await screen.findByText("In Sci-Fi Night")).toBeInTheDocument();
  });

  it("leaves the card unchanged when the add fails", async () => {
    const user = userEvent.setup();
    addToList.mockRejectedValue(new Error("Unable to add item"));
    const menu = await openAddMenu(user);

    await user.click(menu.getByRole("button", { name: "Sci-Fi Night" }));

    expect(await screen.findByText("Unable to add item")).toBeInTheDocument();
    expect(screen.queryByText("In Sci-Fi Night")).not.toBeInTheDocument();
  });

  it("won't offer a list the title is already in twice", async () => {
    const user = userEvent.setup();
    search.mockImplementation(async (type) =>
      type === "movie" ? [result("Solaris", { lists: [SCIFI.id] })] : []
    );
    const menu = await openAddMenu(user);

    const already = menu.getByRole("button", { name: /Sci-Fi Night/ });
    expect(already).toBeDisabled();
    expect(already).toHaveTextContent("Added");

    await user.click(already);
    expect(addToList).not.toHaveBeenCalled();
  });

  it("creates a list and adds the title to it in one go", async () => {
    const user = userEvent.setup();
    createList.mockResolvedValue({
      list: { id: "l-new", name: "Tarkovsky", kind: "custom", itemCount: 0 },
    });
    const menu = await openAddMenu(user);

    await user.click(menu.getByRole("button", { name: /create new list/i }));
    await user.type(menu.getByLabelText("New list name"), "Tarkovsky");
    await user.click(menu.getByRole("button", { name: "Add" }));

    expect(createList).toHaveBeenCalledWith("Tarkovsky");
    expect(addToList).toHaveBeenCalledWith("l-new", {
      type: "movie",
      imdbId: "tt-solaris",
      title: "Solaris",
    });
    expect(await screen.findByText(/Created "Tarkovsky" and added "Solaris"/)).toBeInTheDocument();
  });

  // The create and the add are two calls: a list that was made must stay in the
  // menu even when the add behind it fails, or retrying makes a second list.
  it("keeps a created list when the add into it fails", async () => {
    const user = userEvent.setup();
    createList.mockResolvedValue({
      list: { id: "l-new", name: "Tarkovsky", kind: "custom", itemCount: 0 },
    });
    addToList.mockRejectedValue(new Error("list is full"));
    const menu = await openAddMenu(user);

    await user.click(menu.getByRole("button", { name: /create new list/i }));
    await user.type(menu.getByLabelText("New list name"), "Tarkovsky");
    await user.click(menu.getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText(/Created "Tarkovsky", but couldn't add "Solaris" \(list is full\)/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Solaris to a list" }));
    expect(
      within(screen.getByRole("group", { name: "Add Solaris to a list" })).getByRole("button", {
        name: "Tarkovsky",
      })
    ).toBeInTheDocument();
    expect(createList).toHaveBeenCalledTimes(1);
  });

  it("says so when the list itself couldn't be created", async () => {
    const user = userEvent.setup();
    createList.mockRejectedValue(new Error("Name already taken"));
    const menu = await openAddMenu(user);

    await user.click(menu.getByRole("button", { name: /create new list/i }));
    await user.type(menu.getByLabelText("New list name"), "Watchlist");
    await user.click(menu.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Name already taken")).toBeInTheDocument();
    expect(addToList).not.toHaveBeenCalled();
  });

  it("reports lists it couldn't load, instead of showing an empty menu as the answer", async () => {
    const user = userEvent.setup();
    getLists.mockRejectedValue(new Error("Lists unavailable"));
    const menu = await openAddMenu(user);

    expect(await screen.findByText("Lists unavailable")).toBeInTheDocument();
    expect(menu.getByText(/no lists yet/i)).toBeInTheDocument();
  });

  it("closes the add menu on Escape", async () => {
    const user = userEvent.setup();
    await openAddMenu(user);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Add Solaris to a list" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Add Solaris to a list" })).toHaveFocus();
  });
});
