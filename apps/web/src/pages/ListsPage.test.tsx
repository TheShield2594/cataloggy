import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import type { CatalogList, ListItemWithMeta } from "../api";
import { ToastProvider } from "../hooks/useToast";
import { ListsPage } from "./ListsPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getLists: vi.fn(),
      getListItems: vi.fn(),
      createList: vi.fn(),
      deleteList: vi.fn(),
      renameList: vi.fn(),
      addToList: vi.fn(),
      removeFromList: vi.fn(),
      search: vi.fn(),
    },
  };
});

// The panel fetches metadata and history of its own the moment an item opens;
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
const getListItems = vi.mocked(api.getListItems);

const WATCHLIST: CatalogList = { id: "l-watch", name: "Watchlist", kind: "watchlist", itemCount: 1 };
const SCIFI: CatalogList = { id: "l-scifi", name: "Sci-Fi Night", kind: "custom", itemCount: 1 };

function itemIn(list: CatalogList, name: string): ListItemWithMeta {
  return {
    listId: list.id,
    type: "movie",
    imdbId: `tt-${name.toLowerCase()}`,
    addedAt: "2026-01-01T00:00:00.000Z",
    title: name,
    metadata: { name, poster: null, year: 2001, genres: [], rating: null },
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="search">{location.search}</p>
      <button type="button" onClick={() => navigate(-1)}>history back</button>
    </>
  );
}

function renderPage(initialEntry = "/lists") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/lists"
            element={
              <>
                <ListsPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

const currentSearch = () => screen.getByTestId("search").textContent;

beforeEach(() => {
  getLists.mockResolvedValue({ lists: [WATCHLIST, SCIFI] });
  getListItems.mockImplementation(async (listId: string) => ({
    items: listId === WATCHLIST.id ? [itemIn(WATCHLIST, "Alien")] : [itemIn(SCIFI, "Solaris")],
  }));
});

describe("ListsPage selection in the URL", () => {
  it("names the defaulted first list in the URL", async () => {
    renderPage();

    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));
    expect(await screen.findByText("Alien")).toBeInTheDocument();
  });

  it("opens the list named in the URL rather than the first one", async () => {
    renderPage(`/lists?list=${SCIFI.id}`);

    expect(await screen.findByText("Solaris")).toBeInTheDocument();
    expect(screen.queryByText("Alien")).not.toBeInTheDocument();
    expect(currentSearch()).toBe(`?list=${SCIFI.id}`);
  });

  it("puts a list switch in history, so Back undoes it", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));

    // Anchored: the row's delete button is also named after the list.
    await user.click(screen.getByRole("button", { name: /^sci-fi night/i }));
    await waitFor(() => expect(currentSearch()).toBe(`?list=${SCIFI.id}`));
    expect(await screen.findByText("Solaris")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /history back/i }));

    // Back lands on the previous list, not off the page — the default that put
    // the first list in the URL replaced its entry instead of pushing one.
    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));
    expect(await screen.findByText("Alien")).toBeInTheDocument();
  });

  it("moves to a list that still exists after deleting the selected one", async () => {
    const user = userEvent.setup();
    vi.mocked(api.deleteList).mockResolvedValue(undefined as never);
    // The custom list is the one with a delete button, so it goes first here:
    // deleting the *selected* list is the case that has to land somewhere real.
    getLists.mockResolvedValueOnce({ lists: [SCIFI, WATCHLIST] });
    renderPage();
    await waitFor(() => expect(currentSearch()).toBe(`?list=${SCIFI.id}`));

    // Deferred, as a real reload is: an instantly-resolved one lets the
    // selection and the refreshed sidebar land in the same render and hides
    // the window where the page holds a list set that no longer exists.
    getLists.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ lists: [WATCHLIST] }), 20))
    );
    // Only fetches made from here on say where the selection landed; the ones
    // before belong to the list that was open.
    getListItems.mockClear();
    await user.click(screen.getByRole("button", { name: /delete list sci-fi night/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    // Never back onto the list just deleted, whose ID the pre-delete sidebar
    // still held.
    await waitFor(() => expect(currentSearch()).toBe(`?list=${WATCHLIST.id}`));
    expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
    expect(getListItems).not.toHaveBeenCalledWith(SCIFI.id);
  });

  it("doesn't call a list missing when it was the request that failed", async () => {
    getLists.mockRejectedValue(new Error("Network down"));
    renderPage(`/lists?list=${SCIFI.id}`);

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer exists/i)).not.toBeInTheDocument();
  });

  it("says so when the link points at a list that is gone", async () => {
    renderPage("/lists?list=l-deleted");

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
    // Nothing was fetched for an ID the sidebar doesn't know.
    expect(getListItems).not.toHaveBeenCalled();
    expect(currentSearch()).toBe("?list=l-deleted");
  });
});

describe("ListsPage add-item modal", () => {
  const search = vi.mocked(api.search);
  const addToList = vi.mocked(api.addToList);

  const result = (name: string, type: "movie" | "series" = "movie") => ({
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
  });

  // Scoped to the dialog: the list behind it renders its own buttons for the
  // same titles, so an unscoped query can match the page instead of the modal.
  const openModal = async (user: ReturnType<typeof userEvent.setup>) => {
    renderPage(`/lists?list=${SCIFI.id}`);
    await screen.findByText("Solaris");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.type(dialog.getByLabelText("Search movies and series"), "sol");
    return dialog;
  };

  beforeEach(() => {
    // "Solaris" is already in Sci-Fi Night per the shared fixture, so the same
    // title coming back from search is the already-added case.
    search.mockImplementation(async (type) =>
      type === "movie" ? [result("Solaris"), result("Sunshine")] : []
    );
    addToList.mockResolvedValue(undefined as never);
  });

  it("searches both types at once, because the filter starts on All", async () => {
    const user = userEvent.setup();
    await openModal(user);

    await waitFor(() => expect(search).toHaveBeenCalledWith("movie", "sol"));
    expect(search).toHaveBeenCalledWith("series", "sol");
  });

  it("marks a title already in the list as added, and won't add it twice", async () => {
    const user = userEvent.setup();
    const dialog = await openModal(user);

    const alreadyAdded = await dialog.findByRole("button", { name: /Solaris/ });
    expect(alreadyAdded).toBeDisabled();
    expect(alreadyAdded).toHaveTextContent("Added");

    await user.click(alreadyAdded);
    expect(addToList).not.toHaveBeenCalled();
  });

  it("confirms an add with a toast and flips the row to Added", async () => {
    const user = userEvent.setup();
    const dialog = await openModal(user);

    const row = await dialog.findByRole("button", { name: /Sunshine/ });
    expect(row).not.toHaveTextContent("Added");

    await user.click(row);

    expect(await screen.findByText(/Added "Sunshine" to Sci-Fi Night/)).toBeInTheDocument();
    expect(addToList).toHaveBeenCalledWith(SCIFI.id, {
      type: "movie",
      imdbId: "tt-sunshine",
      title: "Sunshine",
    });
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: /Sunshine/ })).toHaveTextContent("Added")
    );
  });

  it("says so when the add fails, rather than leaving the row looking untouched", async () => {
    const user = userEvent.setup();
    addToList.mockRejectedValue(new Error("list is full"));
    const dialog = await openModal(user);

    await user.click(await dialog.findByRole("button", { name: /Sunshine/ }));

    expect(await screen.findByText(/Couldn't add "Sunshine" \(list is full\)/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: /Sunshine/ })).not.toHaveTextContent("Added");
  });

  it("searches only the chosen type once the filter narrows", async () => {
    const user = userEvent.setup();
    const dialog = await openModal(user);
    await waitFor(() => expect(search).toHaveBeenCalledWith("series", "sol"));

    search.mockClear();
    await user.click(dialog.getByRole("button", { name: "Series" }));

    await waitFor(() => expect(search).toHaveBeenCalledWith("series", "sol"));
    expect(search).not.toHaveBeenCalledWith("movie", "sol");
  });
});
