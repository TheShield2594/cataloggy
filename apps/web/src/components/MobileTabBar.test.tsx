import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { MORE_NAV_ITEMS, MobileTabBar, PRIMARY_NAV_ITEMS, SEARCH_ITEM } from "./MobileTabBar";

// Closing the sheet plays its exit animation before it leaves the DOM. jsdom
// never fires animationend on its own, so these tests ride useExitAnimation's
// fallback timer — the same one that covers a real browser dropping the
// animation.
const dismissSheet = () => waitForElementToBeRemoved(() => screen.queryByRole("dialog"));

const renderBar = (pathname = "/") =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <MobileTabBar pathname={pathname} />
    </MemoryRouter>
  );

const tabBar = () => screen.getByRole("navigation", { name: "Mobile navigation" });

describe("MobileTabBar", () => {
  it("shows five slots in the pill, the count it can fit at 320px", () => {
    renderBar();
    const bar = tabBar();
    // The four tabs and the search circle. Search is a link too, but it sits
    // outside the pill — see the note on SEARCH_ITEM.
    expect(within(bar).getAllByRole("link")).toHaveLength(PRIMARY_NAV_ITEMS.length + 1);
    expect(within(bar).getByRole("button", { name: /more/i })).toBeInTheDocument();
    expect(PRIMARY_NAV_ITEMS.length + 1).toBe(5);
  });

  // Search is the one destination you arrive at with something already in
  // mind, so it gets an affordance of its own instead of a fifth of the pill.
  it("gives search a button of its own beside the pill", () => {
    renderBar("/search");
    const search = within(tabBar()).getByRole("link", { name: SEARCH_ITEM.label });
    expect(search).toHaveAttribute("href", SEARCH_ITEM.to);
    expect(search).toHaveAttribute("aria-current", "page");
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
    const labelled = [
      // The search circle carries an icon and no label, so it is not one of
      // these — it is a fixed 64px and the pill flexes around it.
      ...within(tabBar()).getAllByRole("link", { name: /shelf|discover|calendar|stats/i }),
      within(tabBar()).getByRole("button", { name: /more/i }),
    ];
    expect(labelled).toHaveLength(PRIMARY_NAV_ITEMS.length + 1);
    for (const tab of labelled) {
      expect(tab.className).toContain("min-w-0");
      expect(tab.querySelector("span.truncate")).not.toBeNull();
    }
  });

  it("marks the current primary tab", () => {
    renderBar("/calendar/2026-09");
    expect(within(tabBar()).getByRole("link", { name: /calendar/i })).toHaveAttribute("aria-current", "page");
    expect(within(tabBar()).getByRole("link", { name: /shelf/i })).not.toHaveAttribute("aria-current");
  });

  // No marker under the selected tab. There isn't one on the platform: the
  // accent tint on the icon and the label is the selection, and a rule sliding
  // between five slots was a second answer to a question the colour had
  // already answered.
  it("says which tab is current with the accent, not with a marker under it", () => {
    renderBar("/discover");
    const bar = tabBar();
    expect(bar.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    expect(within(bar).getByRole("link", { name: /discover/i })).toHaveStyle({
      color: "rgb(var(--accent-rgb))",
    });
    expect(within(bar).getByRole("link", { name: /shelf/i })).toHaveStyle({ color: "var(--text-dim)" });
  });

  it("matches the Shelf only on the exact root path", () => {
    renderBar("/search");
    expect(within(tabBar()).getByRole("link", { name: /shelf/i })).not.toHaveAttribute("aria-current");
  });

  it("highlights More while a route behind it is open, and marks that route inside", async () => {
    renderBar("/settings");
    const moreTab = within(tabBar()).getByRole("button", { name: /more/i });
    expect(moreTab).toHaveStyle({ color: "rgb(var(--accent-rgb))" });

    await userEvent.click(moreTab);

    const sheet = screen.getByRole("dialog", { name: "More destinations" });
    expect(within(sheet).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
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

    await dismissSheet();
    expect(moreTab).toHaveFocus();
  });

  it("closes when the backdrop is tapped", async () => {
    renderBar();
    await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

    await userEvent.click(screen.getByRole("button", { name: "Close menu" }));

    await dismissSheet();
  });

  it("closes when a destination behind More is chosen", async () => {
    renderBar();
    await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

    await userEvent.click(screen.getByRole("link", { name: "Settings" }));

    await dismissSheet();
  });

  // The sheet declared aria-modal="true" while trapping nothing, alone among the
  // app's overlays. Tab walked straight out into the page the attribute had just
  // declared inert, and on touch that page scrolled behind it.
  describe("modality", () => {
    it("keeps Tab inside the sheet instead of walking out into the bar behind it", async () => {
      renderBar();
      await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));
      const sheet = screen.getByRole("dialog", { name: "More destinations" });
      const links = within(sheet).getAllByRole("link");

      // From the last item, Tab wraps to the first rather than reaching the nav.
      links[links.length - 1].focus();
      await userEvent.tab();

      expect(sheet.contains(document.activeElement)).toBe(true);
    });

    it("takes the page out of the accessibility tree while it is open", async () => {
      renderBar();
      await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

      expect(tabBar()).toHaveAttribute("inert");
    });

    it("hands the page back when it closes", async () => {
      renderBar();
      await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

      await userEvent.keyboard("{Escape}");
      await dismissSheet();

      expect(tabBar()).not.toHaveAttribute("inert");
    });

    it("locks background scroll, which is what the page did behind it on touch", async () => {
      renderBar();
      await userEvent.click(within(tabBar()).getByRole("button", { name: /more/i }));

      expect(document.body.style.position).toBe("fixed");

      await userEvent.keyboard("{Escape}");
      await dismissSheet();

      expect(document.body.style.position).toBe("");
    });
  });
});
