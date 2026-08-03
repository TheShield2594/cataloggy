import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { MORE_NAV_ITEMS, MobileTabBar, PRIMARY_NAV_ITEMS } from "./MobileTabBar";

const renderBar = (pathname = "/") =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <MobileTabBar pathname={pathname} />
    </MemoryRouter>
  );

const tabBar = () => screen.getByRole("navigation", { name: "Main" });

describe("MobileTabBar", () => {
  it("shows five tabs, the count the bar can fit at 320px", () => {
    renderBar();
    const bar = tabBar();
    expect(within(bar).getAllByRole("link")).toHaveLength(PRIMARY_NAV_ITEMS.length);
    expect(within(bar).getByRole("button", { name: /more/i })).toBeInTheDocument();
    expect(PRIMARY_NAV_ITEMS.length + 1).toBe(5);
  });

  it("keeps every destination reachable — the four that moved are behind More", async () => {
    renderBar();
    expect(within(tabBar()).queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /more/i }));

    const sheet = screen.getByRole("dialog", { name: "More destinations" });
    for (const item of MORE_NAV_ITEMS) {
      expect(within(sheet).getByRole("link", { name: item.label })).toHaveAttribute("href", item.to);
    }
  });

  it("lets a tab label shrink rather than push the bar past the viewport", () => {
    renderBar();
    for (const tab of [...within(tabBar()).getAllByRole("link"), within(tabBar()).getByRole("button", { name: /more/i })]) {
      expect(tab.className).toContain("min-w-0");
      expect(tab.querySelector("span.truncate")).not.toBeNull();
    }
  });

  it("marks the current primary tab", () => {
    renderBar("/lists/abc");
    expect(within(tabBar()).getByRole("link", { name: /lists/i })).toHaveAttribute("aria-current", "page");
    expect(within(tabBar()).getByRole("link", { name: /dashboard/i })).not.toHaveAttribute("aria-current");
  });

  it("matches Dashboard only on the exact root path", () => {
    renderBar("/search");
    expect(within(tabBar()).getByRole("link", { name: /dashboard/i })).not.toHaveAttribute("aria-current");
  });

  it("highlights More while a route behind it is open, and marks that route inside", async () => {
    renderBar("/stats");
    const moreTab = within(tabBar()).getByRole("button", { name: /more/i });
    expect(moreTab.className).toContain("text-claw-text");

    await userEvent.click(moreTab);

    const sheet = screen.getByRole("dialog", { name: "More destinations" });
    expect(within(sheet).getByRole("link", { name: "Stats" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the sheet with focus on its first item and reports its state to assistive tech", async () => {
    renderBar();
    const moreTab = within(tabBar()).getByRole("button", { name: /more/i });
    expect(moreTab).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(moreTab);

    expect(moreTab).toHaveAttribute("aria-expanded", "true");
    const sheet = screen.getByRole("dialog", { name: "More destinations" });
    expect(within(sheet).getByRole("link", { name: MORE_NAV_ITEMS[0].label })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the More tab", async () => {
    renderBar();
    const moreTab = within(tabBar()).getByRole("button", { name: /more/i });
    await userEvent.click(moreTab);

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(moreTab).toHaveFocus();
  });

  it("closes when the backdrop is tapped", async () => {
    renderBar();
    await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when a destination behind More is chosen", async () => {
    renderBar();
    await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
