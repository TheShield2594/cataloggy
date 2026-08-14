import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { Sidebar } from "./Sidebar";

// The rail is `hidden sm:flex`, and it asks `matchMedia` whether it is on screen
// before offering its one-time tip. The shared setup stubs every query as
// unmatched, which would be a phone — where there is no rail to hint about.
beforeEach(() => {
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

function renderSidebar(pinned = false) {
  return render(
    <MemoryRouter>
      <Sidebar pinned={pinned} onPinnedChange={() => {}} />
    </MemoryRouter>
  );
}

// The rail's width is the only thing that says "expanded" — the labels stay in
// the DOM either way, which is exactly why hover-only expansion was invisible
// to a keyboard user rather than merely inconvenient.
// jsdom resolves the inline rem widths against its 16px root font size.
const COLLAPSED_WIDTH = "64px";
const EXPANDED_WIDTH = "240px";

const rail = () => screen.getByRole("navigation", { name: "Primary" }).parentElement as HTMLElement;

describe("Sidebar", () => {
  it("expands when focus reaches the rail, not only on hover", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(rail()).toHaveStyle({ width: COLLAPSED_WIDTH });

    await user.tab();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveFocus();
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

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("title", "Dashboard");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("title", "Settings");

    await user.tab();
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("title");
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
