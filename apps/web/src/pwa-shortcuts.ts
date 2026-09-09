/**
 * The routes offered as long-press shortcuts on the installed app's icon.
 *
 * Everything the tab bar reaches directly — its four tabs plus the search
 * circle beside them — minus the Shelf, which is start_url and would be a
 * long-press target for the page a plain tap already opens.
 *
 * It cannot import components/MobileTabBar.tsx directly: this is read by
 * vite.config.ts while the config is being loaded, and that module pulls in
 * React and lucide-react, neither of which belongs in a Vite config's module
 * graph. pwa-shortcuts.test.ts asserts the two agree, so a renamed or moved tab
 * fails the build rather than leaving a shortcut pointing at a dead route.
 */
export const PWA_SHORTCUTS: { label: string; url: string }[] = [
  { label: "Discover", url: "/discover" },
  { label: "Calendar", url: "/calendar" },
  { label: "Stats", url: "/stats" },
  { label: "Search", url: "/search" },
];
