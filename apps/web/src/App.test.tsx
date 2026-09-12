import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { App } from "./App";
import { runtimeConfig } from "./api";
import { first } from "./test/present";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    api: { ...actual.api, getProfiles: vi.fn().mockResolvedValue({ profiles: [] }) },
  };
});

// The Shelf is the landing route and fires a page's worth of requests on
// mount; this suite is only about what the top bar renders around it.
vi.mock("./pages/ShelfPage", () => ({ ShelfPage: () => <p>shelf</p> }));

vi.mock("./utils/routePrefetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/routePrefetch")>();
  return {
    ...actual,
    // Stands in for the real page's query field, which carries `autoFocus` —
    // the one bit of SearchPage the shell's focus move has to reckon with.
    loadSearchPage: () =>
      Promise.resolve({
        SearchPage: () => (
          <>
            <p>search page</p>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the point of the stand-in is that it claims focus, as the real field does */}
            <input aria-label="Search movies and TV shows" autoFocus />
          </>
        ),
      }),
    schedulePrefetchOnIdle: () => {},
  };
});

beforeEach(() => {
  // Past the setup wizard and the profile picker, which otherwise render
  // instead of the shell.
  window.localStorage.setItem(runtimeConfig.tokenKey, "test-token");
  window.localStorage.setItem(runtimeConfig.profileIdKey, "profile-1");
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

const headerSearch = () => screen.queryByRole("button", { name: "Search (⌘K)" });

describe("top bar search", () => {
  it("offers the palette trigger on a route with no search field of its own", async () => {
    renderAt("/");

    expect(await screen.findByText("shelf")).toBeInTheDocument();
    expect(headerSearch()).toBeInTheDocument();
  });

  it("stands down on the search page, which has its own field", async () => {
    renderAt("/search");

    expect(await screen.findByText("search page")).toBeInTheDocument();
    expect(headerSearch()).not.toBeInTheDocument();
  });
});

/*
 * Client-side navigation leaves focus on whatever was clicked, so the shell
 * moves it into `<main>` to give a screen reader somewhere to start reading.
 * The exception is a route that focuses its own content — SearchPage's query
 * field — which used to race the shell and lose or win depending on whether its
 * chunk was warm.
 */
describe("focus on route change", () => {
  const mainEl = () => screen.getByRole("main", { name: "Main content" });
  const goToSearch = async (user: ReturnType<typeof userEvent.setup>) => {
    // The sidebar's own link, so focus starts where a real navigation leaves it.
    await user.click(first(screen.getAllByRole("link", { name: "Search" }), "Search link"));
  };

  it("moves focus into main on a route that claims none", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await screen.findByText("search page");

    await user.click(first(screen.getAllByRole("link", { name: "Shelf" }), "Shelf link"));

    await waitFor(() => expect(mainEl()).toHaveFocus());
  });

  it("leaves the landing route's focus alone on first render", async () => {
    renderAt("/");
    await screen.findByText("shelf");

    expect(mainEl()).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("yields to a route that focuses its own content", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await screen.findByText("shelf");

    await goToSearch(user);

    const field = await screen.findByLabelText("Search movies and TV shows");
    await waitFor(() => expect(field).toHaveFocus());
    expect(mainEl()).not.toHaveFocus();
  });

  // The shell must not confuse "focus is still parked on `<main>` from the last
  // navigation" with "the new page claimed focus" — that would skip the move and
  // leave a screen reader with no announcement for the second page.
  it("re-focuses main when focus is already sitting on it", async () => {
    const user = userEvent.setup();
    renderAt("/search");
    await screen.findByText("search page");

    await user.click(first(screen.getAllByRole("link", { name: "Shelf" }), "Shelf link"));
    await waitFor(() => expect(mainEl()).toHaveFocus());

    const focusSpy = vi.spyOn(mainEl(), "focus");
    await user.click(first(screen.getAllByRole("link", { name: "Calendar" }), "Calendar link"));

    await waitFor(() => expect(focusSpy).toHaveBeenCalled());
  });
});
