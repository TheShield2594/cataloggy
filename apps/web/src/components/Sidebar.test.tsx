import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { CatalogList } from "../api";
import { SIDEBAR_MANAGE_ITEMS, Sidebar } from "./Sidebar";

// The rail reads two things besides its routes: the profile's lists, which it
// fetches itself (they are on screen long before anyone visits /lists), and the
// shell's health report, which the Settings page shares. Both are stubbed here
// so this file stays about the rail.
const lists = vi.hoisted(() => ({ value: [] as CatalogList[] }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { getLists: vi.fn(async () => ({ lists: lists.value })) },
}));

const health = vi.hoisted(() => ({
  value: {} as Record<string, { tone: "ok" | "warn" | "bad" | "idle"; label: string }>,
}));
vi.mock("../hooks/useSettingsHealth", () => ({
  useSettingsHealth: () => ({ sections: health.value, refresh: () => {} }),
}));

const list = (over: Partial<CatalogList> = {}): CatalogList => ({
  id: "l1",
  name: "Watchlist",
  kind: "watchlist",
  itemCount: 0,
  ...over,
});

// The rail is `hidden sm:flex`, and it asks `matchMedia` whether it is on screen
// before offering its one-time tip. The shared setup stubs every query as
// unmatched, which would be a phone — where there is no rail to hint about.
beforeEach(() => {
  lists.value = [];
  health.value = {};
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 640px)",
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
});

function renderSidebar(pinned = false, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar pinned={pinned} onPinnedChange={() => {}} />
    </MemoryRouter>
  );
}

/** Every rail row announcing itself as the page you are on. Should be one. */
const currentRows = () =>
  [...screen.getByRole("navigation", { name: "Primary" }).querySelectorAll('[aria-current="page"]')].map(
    (el) => el.textContent
  );

// The rail's width is the only thing that says "expanded" — the labels stay in
// the DOM either way, which is exactly why hover-only expansion was invisible
// to a keyboard user rather than merely inconvenient.
//
// Compared as the authored `calc()` rather than a pixel count: the rail adds
// `env(safe-area-inset-left)` so its material can run under a landscape notch
// while its rows stay clear of one, and jsdom neither resolves `env()` nor
// evaluates `calc()`. The two states are still distinguishable, which is all
// these assertions need.
const COLLAPSED_WIDTH = "calc(4rem + env(safe-area-inset-left))";
const EXPANDED_WIDTH = "calc(15rem + env(safe-area-inset-left))";

const rail = () => screen.getByRole("navigation", { name: "Primary" }).parentElement as HTMLElement;

describe("Sidebar", () => {
  /*
   * `NavLink` matches the pathname and nothing else, and the list rows differ
   * only by their query string — so all of them, plus the "All Lists" row that
   * `end` was supposed to hold back, announced themselves as the current page
   * at once. Three answers to "where am I", and the marker takes the first one
   * it finds, so it parked on the wrong row too.
   */
  it("marks exactly one row current on a list route, and it is the open list", async () => {
    lists.value = [
      list({ id: "w", name: "Watchlist", kind: "watchlist", itemCount: 3 }),
      list({ id: "m", name: "Movie Night", kind: "custom", itemCount: 2 }),
    ];
    renderSidebar(true, "/lists?list=m");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await within(nav).findByRole("link", { name: /Movie Night/ });

    expect(currentRows()).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: /Movie Night/ })).toHaveAttribute("aria-current", "page");
  });

  // The bare page is its own destination: with no `?list=`, the row that
  // manages the lists is the one you are on.
  it("marks All Lists current only when no list is open", async () => {
    lists.value = [list({ id: "w", name: "Watchlist", kind: "watchlist", itemCount: 3 })];
    renderSidebar(true, "/lists");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await within(nav).findByRole("link", { name: /Watchlist/ });

    expect(currentRows()).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "All Lists" })).toHaveAttribute("aria-current", "page");
  });

  /*
   * The source rows are shortcuts into Settings, not destinations of their
   * own — the Settings row above them is the page. As NavLinks they all lit up
   * beside it the moment you arrived there.
   */
  it("leaves the source rows uncurrent on the settings route", async () => {
    health.value = { trakt: { tone: "ok", label: "Synced 4m ago" } };
    renderSidebar(true, "/settings?tab=integrations");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await within(nav).findByRole("link", { name: /Trakt/ });

    expect(currentRows()).toHaveLength(1);
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  /*
   * The rail was a menu of routes with a column of empty space under it. A
   * source list on the platform carries the app's own contents: your lists by
   * name, with how many are in each. "Lists" as a single row is a menu item —
   * it makes you open a page to find out that the watchlist has 27 things in it.
   */
  it("lists the lists themselves, with what is in each", async () => {
    lists.value = [
      list({ id: "w", name: "Watchlist", kind: "watchlist", itemCount: 27 }),
      list({ id: "m", name: "Movie Night", kind: "custom", itemCount: 9 }),
    ];
    renderSidebar(true);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const row = await within(nav).findByRole("link", { name: /Watchlist/ });
    expect(row).toHaveAttribute("href", "/lists?list=w");
    expect(row).toHaveTextContent("27");
    expect(within(nav).getByRole("link", { name: /Movie Night/ })).toHaveAttribute("href", "/lists?list=m");
    expect(within(nav).getByText("Lists")).toBeInTheDocument();
  });

  /*
   * The page that makes and renames lists sits at the foot of the group it
   * manages, rather than as a second row called "Lists" further down — two rows
   * of that name in one column would be a puzzle. It is also why the group
   * renders on a profile with no lists yet: without it, /lists would be
   * unreachable from the rail on a fresh install.
   */
  it("keeps the page that manages lists at the foot of the list group", async () => {
    renderSidebar(true);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const all = await within(nav).findByRole("link", { name: "All Lists" });
    expect(all).toHaveAttribute("href", "/lists");
    expect(SIDEBAR_MANAGE_ITEMS.map((i) => i.label)).toEqual(["Games", "History"]);
  });

  /*
   * The dot is never the whole message (SC 1.4.1) — the words beside it are
   * what separate "Synced 4m ago" from "Token expired".
   */
  it("puts each configured source's state in the rail, in words as well as colour", async () => {
    health.value = { trakt: { tone: "ok", label: "Synced 4m ago" } };
    renderSidebar(true);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const row = await within(nav).findByRole("link", { name: /Trakt/ });
    expect(row).toHaveTextContent("Synced 4m ago");
    expect(row).toHaveAttribute("href", "/settings?tab=integrations");
    expect(within(nav).getByText("Sources")).toBeInTheDocument();
  });

  // A source nobody has set up is doing what it was asked to; five rows reading
  // "Not set" would be a permanent to-do list beside every screen in the app.
  it("leaves an unconfigured source out rather than listing it as not set", async () => {
    health.value = { omdb: { tone: "idle", label: "Not set" } };
    renderSidebar(true);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await waitFor(() => expect(within(nav).getByText("Manage")).toBeInTheDocument());
    expect(within(nav).queryByText("Sources")).toBeNull();
    expect(within(nav).queryByRole("link", { name: /OMDb/ })).toBeNull();
  });

  // Below `sm` this component is `display: none` and the tab bar navigates
  // instead — a phone should not pay for a rail it never sees.
  it("fetches nothing while the rail is off screen", async () => {
    const { api } = await import("../api");
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));

    renderSidebar(true);

    expect(vi.mocked(api.getLists)).not.toHaveBeenCalled();
  });

  /*
   * The second group. Lists, Games and History were a row of links inside the
   * Shelf's own header — a page carrying navigation to three other pages,
   * level with its subtitle. They belong in the source list, under a heading
   * that says what kind of destination they are.
   */
  it("files the manage surfaces in a group of their own", () => {
    renderSidebar(true);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByText("Manage")).toBeInTheDocument();
    for (const item of SIDEBAR_MANAGE_ITEMS) {
      expect(within(nav).getByRole("link", { name: item.label })).toHaveAttribute("href", item.to);
    }
  });

  it("expands when focus reaches the rail, not only on hover", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(rail()).toHaveStyle({ width: COLLAPSED_WIDTH });

    await user.tab();
    expect(screen.getByRole("link", { name: "Shelf" })).toHaveFocus();
    expect(rail()).toHaveStyle({ width: EXPANDED_WIDTH });
  });

  it("stays expanded while focus moves between two of its own controls", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.tab();
    await user.tab();

    expect(screen.getByRole("link", { name: "Search" })).toHaveFocus();
    expect(rail()).toHaveStyle({ width: EXPANDED_WIDTH });
  });

  it("collapses again once focus leaves for something outside the rail", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Sidebar pinned={false} onPinnedChange={() => {}} />
        <button type="button">elsewhere</button>
      </MemoryRouter>
    );

    await user.tab();
    expect(rail()).toHaveStyle({ width: EXPANDED_WIDTH });

    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(rail()).toHaveStyle({ width: COLLAPSED_WIDTH });
  });

  it("names each collapsed icon with a title, and drops it once the label is readable", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole("link", { name: "Shelf" })).toHaveAttribute("title", "Shelf");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("title", "Settings");

    await user.tab();
    expect(screen.getByRole("link", { name: "Shelf" })).not.toHaveAttribute("title");
  });

  // The rail's marker is one element that moves, so there is exactly one of it
  // no matter which route is open — and none when no item matches.
  it("keeps a single active marker in the rail", () => {
    render(
      <MemoryRouter initialEntries={["/stats"]}>
        <Sidebar pinned onPinnedChange={() => {}} />
      </MemoryRouter>
    );

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const markers = nav.querySelectorAll(':scope > span[aria-hidden="true"]');
    expect(markers).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Stats" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the pin tip on the first visit, before any hover has happened", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByText("Quick tip")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Got it/ }));
    expect(screen.queryByText("Quick tip")).not.toBeInTheDocument();
  });

  it("does not show the tip again once it has been seen", () => {
    localStorage.setItem("cataloggy:sidebar-hint-seen", "1");
    renderSidebar();

    expect(screen.queryByText("Quick tip")).not.toBeInTheDocument();
  });

  it("does not spend the one-time tip on a viewport with no rail to hint about", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));
    renderSidebar();

    expect(screen.queryByText("Quick tip")).not.toBeInTheDocument();
    // Unseen, so it is still there for the first desktop visit.
    expect(localStorage.getItem("cataloggy:sidebar-hint-seen")).toBeNull();
  });

  it("does not offer a tip about pinning to someone whose rail is already pinned", () => {
    renderSidebar(true);

    expect(screen.queryByText("Quick tip")).not.toBeInTheDocument();
  });
});
