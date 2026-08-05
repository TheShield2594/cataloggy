// Generates the iOS `apple-touch-startup-image` splash screens in
// apps/web/public/splash/ from the app logo, plus the matching <link> tags for
// apps/web/index.html.
//
// The assets are committed, so this only needs re-running when the logo or the
// device list changes. sharp is deliberately not a workspace dependency (it is
// a large native module that would be pulled into every CI run and Docker
// build for a script nobody runs day to day) — install it just for the run:
//
//   pnpm add -Dw sharp && node scripts/generate-splash.mjs && pnpm remove -w sharp
//
// Pass --html to print the <link> tags instead of writing images.

import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { INK_ON_DARK, loadSharp, logoSvg, repoRoot } from "./brand.mjs";

const OUT_DIR = join(repoRoot, "apps/web/public/splash");

// Keep in sync with the PWA manifest's `background_color` in
// apps/web/vite.config.ts. The splash is intentionally the dark brand colour
// rather than the default light theme: it is the installed-app launch screen,
// and the manifest already declares dark as the app's background. The mark is
// therefore drawn in its light ink — the default near-black one would be
// invisible here.
const BACKGROUND = "#0d0b0a";

// The box the logo is scaled to fit inside, as a fraction of each screen edge.
// The mark is taller than it is wide, so height is what binds in portrait and
// width in landscape — capping both keeps it the same comfortable size either
// way up, rather than filling the screen in one orientation.
const LOGO_MAX_WIDTH_RATIO = 0.5;
const LOGO_MAX_HEIGHT_RATIO = 0.4;

// CSS pixel dimensions (portrait) and device pixel ratio per device. Devices
// that share all three collapse onto one entry, since that is all the media
// query can distinguish.
const DEVICES = [
  { label: "iPhone SE (1st gen), 5s", width: 320, height: 568, ratio: 2 },
  { label: "iPhone SE (2nd/3rd gen), 8, 7, 6s, 6", width: 375, height: 667, ratio: 2 },
  { label: "iPhone 8 Plus, 7 Plus, 6s Plus, 6 Plus", width: 414, height: 736, ratio: 3 },
  { label: "iPhone 11 Pro, XS, X", width: 375, height: 812, ratio: 3 },
  { label: "iPhone 11, XR", width: 414, height: 896, ratio: 2 },
  { label: "iPhone 11 Pro Max, XS Max", width: 414, height: 896, ratio: 3 },
  { label: "iPhone 13 mini, 12 mini", width: 360, height: 780, ratio: 3 },
  { label: "iPhone 14, 13, 13 Pro, 12, 12 Pro", width: 390, height: 844, ratio: 3 },
  { label: "iPhone 14 Plus, 13 Pro Max, 12 Pro Max", width: 428, height: 926, ratio: 3 },
  { label: "iPhone 16, 15, 15 Pro, 14 Pro", width: 393, height: 852, ratio: 3 },
  { label: "iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max", width: 430, height: 932, ratio: 3 },
  { label: "iPhone 17, 16 Pro", width: 402, height: 874, ratio: 3 },
  { label: "iPhone Air", width: 420, height: 912, ratio: 3 },
  { label: "iPhone 17 Pro Max, 16 Pro Max", width: 440, height: 956, ratio: 3 },
  { label: "iPad mini (5th gen), iPad (6th gen), iPad Air (3rd gen)", width: 768, height: 1024, ratio: 2 },
  { label: "iPad (10.2-inch, 7th-9th gen)", width: 810, height: 1080, ratio: 2 },
  { label: "iPad Pro (10.5-inch), iPad Air (3rd gen)", width: 834, height: 1112, ratio: 2 },
  { label: "iPad mini (6th gen)", width: 744, height: 1133, ratio: 2 },
  { label: "iPad Air (11-inch), iPad (10th gen)", width: 820, height: 1180, ratio: 2 },
  { label: "iPad Pro (11-inch, 1st-3rd gen)", width: 834, height: 1194, ratio: 2 },
  { label: "iPad Pro (11-inch, M4)", width: 834, height: 1210, ratio: 2 },
  { label: "iPad Pro (12.9-inch)", width: 1024, height: 1366, ratio: 2 },
  { label: "iPad Pro (13-inch, M4)", width: 1032, height: 1376, ratio: 2 }
];

/** Every image to emit: both orientations for every device. */
function splashTargets() {
  return DEVICES.flatMap((device) => {
    const short = device.width * device.ratio;
    const long = device.height * device.ratio;
    return [
      { device, orientation: "portrait", width: short, height: long },
      { device, orientation: "landscape", width: long, height: short }
    ];
  });
}

const fileName = ({ width, height }) => `apple-splash-${width}x${height}.png`;

const mediaQuery = ({ device, orientation }) =>
  `(device-width: ${device.width}px) and (device-height: ${device.height}px) ` +
  `and (-webkit-device-pixel-ratio: ${device.ratio}) and (orientation: ${orientation})`;

function htmlTags() {
  return splashTargets()
    .map(
      (target) =>
        `    <link rel="apple-touch-startup-image" media="${mediaQuery(target)}" href="/splash/${fileName(target)}" />`
    )
    .join("\n");
}

async function generateImages() {
  const sharp = await loadSharp("generate-splash.mjs");

  // Trim the mark's transparent padding so it can be centred and scaled by its
  // visible bounds rather than the square viewBox it is drawn in. Rendered
  // large enough that every screen below scales it down rather than up.
  const svg = await logoSvg(INK_ON_DARK);
  const logo = await sharp(svg)
    .resize({ height: 2048 })
    .trim({ threshold: 0 })
    .toBuffer({ resolveWithObject: true });

  await mkdir(OUT_DIR, { recursive: true });
  const targets = splashTargets();
  const expected = new Set(targets.map(fileName));
  for (const stale of await readdir(OUT_DIR)) {
    if (!expected.has(stale)) await rm(join(OUT_DIR, stale));
  }

  for (const target of targets) {
    const { width, height } = target;

    const maxWidth = width * LOGO_MAX_WIDTH_RATIO;
    const maxHeight = height * LOGO_MAX_HEIGHT_RATIO;
    const scale = Math.min(maxWidth / logo.info.width, maxHeight / logo.info.height);
    const logoWidth = Math.round(logo.info.width * scale);
    const logoHeight = Math.round(logo.info.height * scale);

    const scaled = await sharp(logo.data).resize(logoWidth, logoHeight).toBuffer();

    await sharp({
      create: { width, height, channels: 4, background: BACKGROUND }
    })
      .composite([
        {
          input: scaled,
          left: Math.round((width - logoWidth) / 2),
          top: Math.round((height - logoHeight) / 2)
        }
      ])
      // A flat background plus a flat-shaded logo quantises to a small palette
      // with no visible loss, which keeps 46 full-resolution screens under
      // ~2.5 MB total.
      .png({ palette: true, colours: 128, dither: 0.5, compressionLevel: 9, effort: 10 })
      .toFile(join(OUT_DIR, fileName(target)));
  }

  console.log(`Wrote ${targets.length} splash images to apps/web/public/splash/`);
}

if (process.argv.includes("--html")) {
  console.log(htmlTags());
} else {
  await generateImages();
}
