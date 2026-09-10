import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";
import { PWA_SHORTCUTS } from "./src/pwa-shortcuts";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

// Android's rich install dialog — the one with a description and a preview —
// only appears when the manifest carries a screenshot for that form factor;
// without one Chrome falls back to the one-line mini-infobar, which converts far
// worse. They are the one manifest field that can't be written from the source
// tree, since they have to be captures of a real, populated instance.
//
// So they are opt-in by file: drop the two PNGs below into public/screenshots/
// and they are picked up on the next build, no config change. Sizes must match
// the images exactly or Chrome rejects the entry outright.
const SCREENSHOTS = [
  {
    src: "/screenshots/narrow.png",
    sizes: "1080x2340",
    type: "image/png",
    form_factor: "narrow" as const,
    label: "Your watchlist on a phone",
  },
  {
    src: "/screenshots/wide.png",
    sizes: "1920x1080",
    type: "image/png",
    form_factor: "wide" as const,
    label: "The Cataloggy dashboard",
  },
];

const screenshots = SCREENSHOTS.filter((shot) => existsSync(join(publicDir, shot.src)));

// Long-press targets on the installed icon. Dashboard is deliberately not among
// them: it is start_url, so it would be a shortcut to the page the icon already
// opens.
const navShortcuts = () =>
  PWA_SHORTCUTS.map((item) => ({
    name: item.label,
    short_name: item.label,
    url: item.url,
  }));

// Extra hostnames (beyond IPs/localhost, which Vite always allows) that may
// reach this dev/preview server. Comma-separated, set via the ALLOWED_HOSTS env
// var.
//
// Dev and preview only, and deliberately not documented as a deployment
// setting: the production `web` image serves the built bundle with `serve`,
// which has no host allowlist to hand this to, so a variable plumbed through
// compose would have been a control that isn't there. Host filtering in a
// deployment belongs to whatever reverse proxy terminates the request.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // iOS launch screens are read by Safari straight from the network when
        // the app is added to the home screen, so precaching all 46 of them
        // would just push ~2.5 MB at every install for no benefit. The install
        // screenshots are the same bargain: Chrome fetches them while showing
        // the install dialog, which is before there is a service worker at all.
        globIgnores: ["config.js", "splash/**", "screenshots/**"]
      },
      includeAssets: [
        "favicon.ico",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-512-full.png"
      ],
      manifest: {
        // Chrome warns without this, and the warning matters: app identity
        // otherwise derives from start_url, so changing start_url later would
        // install a *second* app rather than update the first — orphaning the
        // icon on every home screen that already has one. Pinned to "/" so the
        // identity survives any future change to where the app opens.
        id: "/",
        name: "Cataloggy",
        short_name: "Cataloggy",
        description:
          "Track what you watch and play, keep your lists in sync, and browse it all from Stremio.",
        start_url: "/",
        // Same value the start_url directory implies, written down so it stops
        // being an accident of the start_url.
        scope: "/",
        display: "standalone",
        // Both of these are what Android paints for an installed app — the
        // launch splash and the system bar — so they have to be a theme the app
        // actually has. The accent orange was neither: none of the five themes
        // is orange-topped, so a light-theme user launched into a black splash
        // and then sat under an orange status bar. These match the light theme,
        // which is also what index.html ships as its <meta name="theme-color">;
        // theme-init.js still overrides that meta per theme wherever a browser
        // honours it.
        // Keep in sync with THEME_BG.light in apps/web/src/hooks/useTheme.ts.
        background_color: "#f2f2f7",
        theme_color: "#f2f2f7",
        shortcuts: navShortcuts(),
        ...(screenshots.length > 0 ? { screenshots } : {}),
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          // One file, two entries, because the two purposes want opposite
          // things. `maskable` is cropped by the launcher, so the mark is padded
          // to 62% (see scripts/generate-icons.mjs); a surface reading that same
          // padded file as `any` — the Chrome install dialog, some launchers —
          // draws it uncropped and the mark just looks small in a cream box.
          // icon-512-full.png is the same mark at the favicon's 86%.
          {
            src: "/icons/icon-512-full.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 7002,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {})
  },
  preview: {
    host: "0.0.0.0",
    port: 7002,
    ...(allowedHosts.length > 0 ? { allowedHosts } : {})
  }
});
