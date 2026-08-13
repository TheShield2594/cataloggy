/**
 * The routes offered as long-press shortcuts on the installed app's icon.
 *
 * A subset of PRIMARY_NAV_ITEMS in components/MobileTabBar.tsx, minus Dashboard
 * (which is start_url). It cannot import that module directly — this is read by
 * vite.config.ts while the config is being loaded, and MobileTabBar pulls in
 * React and lucide-react, neither of which belongs in a Vite config's module
 * graph. pwa-shortcuts.test.ts asserts the two agree, so a renamed or moved tab
 * fails the build rather than leaving a shortcut pointing at a dead route.
 */
export const PWA_SHORTCUTS: { label: string; url: string }[] = [
  { label: "Search", url: "/search" },
  { label: "Lists", url: "/lists" },
  { label: "Calendar", url: "/calendar" },
];
