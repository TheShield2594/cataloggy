import { render, screen, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { MORE_NAV_ITEMS, MobileTabBar, PRIMARY_NAV_ITEMS } from "./MobileTabBar";

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

  // One marker that moves, not one per tab that blinks on and off — the whole
  // point of positioning it arithmetically off the active index.
  it("keeps a single active marker and slides it to the current tab", () => {
    const marker = (bar: HTMLElement) => {
      const found = bar.querySelectorAll(':scope > span[aria-hidden="true"]');
      expect(found).toHaveLength(1);
      return found[0] as HTMLElement;
    };

    const { unmount } = renderBar("/");
    expect(marker(tabBar()).style.transform).toBe("translateX(0%)");
    unmount();

    renderBar("/lists");
    // Third of five slots.
    expect(marker(tabBar()).style.transform).toBe("translateX(200%)");
  });

  it("parks the marker on More while a route behind it is open", () => {
    renderBar("/stats");
    const marker = tabBar().querySelector<HTMLElement>(':scope > span[aria-hidden="true"]');
    expect(marker?.style.transform).toBe("translateX(400%)");
  });

  it("shows no marker at all on a route the bar doesn't own", () => {
    renderBar("/nowhere");
    expect(tabBar().querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(0);
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
