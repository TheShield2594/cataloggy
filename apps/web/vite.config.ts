import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";

// Extra hostnames (beyond IPs/localhost, which Vite always allows) that may
// reach this dev/preview server — e.g. a domain proxied via Nginx Proxy
// Manager. Comma-separated, set via the ALLOWED_HOSTS env var.
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

// The font's @font-face lives inside the app stylesheet, so the browser can only
// discover it once that stylesheet has downloaded and parsed — a round trip
// after it already knew it would need it. The filename is content-hashed, so the
// preload tag can't be written by hand in index.html; it is read off the bundle
// here instead. Only the latin subset: the others are for text most installs
// never render, and preloading all three would compete with the app's own JS.
function preloadLatinFont() {
  return {
    name: "cataloggy:preload-latin-font",
    enforce: "post" as const,
    transformIndexHtml(html: string, ctx: { bundle?: Record<string, unknown> }) {
      const file = Object.keys(ctx.bundle ?? {}).find((name) =>
        /plus-jakarta-sans-latin-wght-normal-[^/]*\.woff2$/.test(name)
      );
      if (!file) return html;
      return {
        html,
        tags: [
          {
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              href: `/${file}`,
              // Fonts are always fetched anonymously, preload included — without
              // this the preloaded copy sits in a different connection pool and
              // is simply downloaded twice.
              crossorigin: "",
            },
            injectTo: "head-prepend" as const,
          },
        ],
      };
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  plugins: [
    react(),
    preloadLatinFont(),
    VitePWA({
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // iOS launch screens are read by Safari straight from the network when
        // the app is added to the home screen, so precaching all 46 of them
        // would just push ~2.5 MB at every install for no benefit.
        globIgnores: ["config.js", "splash/**"]
      },
      includeAssets: ["favicon.ico", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Cataloggy",
        short_name: "Cataloggy",
        start_url: "/",
        display: "standalone",
        background_color: "#0d0b0a",
        theme_color: "#d97742",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
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
