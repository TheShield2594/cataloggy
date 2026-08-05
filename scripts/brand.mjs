// Shared bits of the Cataloggy mark, for the two generators that rasterise it
// (generate-icons.mjs and generate-splash.mjs).
//
// The mark lives in apps/web/public/logo.svg — served as-is to browsers that
// prefer an SVG favicon, and the source every committed PNG below is rendered
// from. At ~4 kB it costs nothing to ship, unlike the 1.2 MB raster it replaced.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOGO_SVG = join(repoRoot, "apps/web/public/logo.svg");

/** The cat's ink on a light surface, and the same on a dark one. */
export const INK_ON_LIGHT = "#2a2b2f";
export const INK_ON_DARK = "#faf5f0";

/** The light surface every icon is drawn on — `--bg-0` in the light theme. */
export const CREAM = "#faf6ef";

/**
 * The mark as an SVG buffer, with the cat's ink swapped for `ink`.
 *
 * The file states its ink both as a presentation attribute and as a CSS rule
 * so a dark browser UI gets a legible favicon; librsvg (what sharp renders
 * with) never matches `prefers-color-scheme`, so choosing the ink here is a
 * substitution rather than a media query.
 */
export async function logoSvg(ink = INK_ON_LIGHT) {
  const svg = await readFile(LOGO_SVG, "utf8");
  return Buffer.from(svg.replaceAll(INK_ON_LIGHT, ink));
}

/** Loads sharp, or explains how to install it for the length of one run. */
export async function loadSharp(script) {
  try {
    return (await import("sharp")).default;
  } catch {
    console.error(
      "sharp is not installed. Run:\n" +
        `  pnpm add -Dw sharp && node scripts/${script} && pnpm remove -w sharp`
    );
    process.exit(1);
  }
}
