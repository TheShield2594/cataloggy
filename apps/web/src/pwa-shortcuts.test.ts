import { describe, expect, it } from "vitest";
import { PWA_SHORTCUTS } from "./pwa-shortcuts";
import { PRIMARY_NAV_ITEMS, SEARCH_ITEM } from "./components/MobileTabBar";

// Everything the bar reaches with one tap: the pill's four, then the circle.
const BAR_DESTINATIONS = [...PRIMARY_NAV_ITEMS, SEARCH_ITEM];

// The shortcut list is duplicated out of MobileTabBar so that vite.config.ts can
// read it without pulling React into the config's module graph. These are the
// checks that keep the duplicate honest.
describe("PWA shortcuts", () => {
  it("points every shortcut at a route the primary nav actually has", () => {
    const navRoutes = new Map(BAR_DESTINATIONS.map((item) => [item.to, item.label]));

    for (const shortcut of PWA_SHORTCUTS) {
      expect(navRoutes.get(shortcut.url)).toBe(shortcut.label);
    }
  });

  it("covers every one-tap destination except the one start_url already opens", () => {
    // A shortcut to "/" would be a long-press target for the page the icon
    // opens on a plain tap.
    expect(PWA_SHORTCUTS.map((shortcut) => shortcut.url)).toEqual(
      BAR_DESTINATIONS.filter((item) => item.to !== "/").map((item) => item.to)
    );
  });
});
