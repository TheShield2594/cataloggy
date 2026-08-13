import { describe, expect, it } from "vitest";
import { PWA_SHORTCUTS } from "./pwa-shortcuts";
import { PRIMARY_NAV_ITEMS } from "./components/MobileTabBar";

// The shortcut list is duplicated out of MobileTabBar so that vite.config.ts can
// read it without pulling React into the config's module graph. These are the
// checks that keep the duplicate honest.
describe("PWA shortcuts", () => {
  it("points every shortcut at a route the primary nav actually has", () => {
    const navRoutes = new Map(PRIMARY_NAV_ITEMS.map((item) => [item.to, item.label]));

    for (const shortcut of PWA_SHORTCUTS) {
      expect(navRoutes.get(shortcut.url)).toBe(shortcut.label);
    }
  });

  it("covers every primary tab except the one start_url already opens", () => {
    // A shortcut to "/" would be a long-press target for the page the icon
    // opens on a plain tap.
    expect(PWA_SHORTCUTS.map((shortcut) => shortcut.url)).toEqual(
      PRIMARY_NAV_ITEMS.filter((item) => item.to !== "/").map((item) => item.to)
    );
  });
});
