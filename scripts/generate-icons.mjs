// Generates the app icons in apps/web/public/ from the mark in
// apps/web/public/logo.svg: the two PWA icons and the .ico the browser tab
// falls back to.
//
// The assets are committed, so this only needs re-running when the mark
// changes. sharp is deliberately not a workspace dependency (a large native
// module that would be pulled into every CI run and Docker build for a script
// nobody runs day to day) — install it just for the run:
//
//   pnpm add -Dw sharp && node scripts/generate-icons.mjs && pnpm remove -w sharp

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CREAM, loadSharp, logoSvg, repoRoot } from "./brand.mjs";

const PUBLIC_DIR = join(repoRoot, "apps/web/public");

// Height of the mark as a fraction of the icon it sits on.
//
// 512 is declared `any maskable`, so Android may crop it to anything inside a
// circle 80% of its width: at 0.62 the mark's corners stay inside that circle
// with room to spare. 192 is only ever shown whole (browser tab strips, the
// iOS home screen, notifications), so it can breathe closer to the edge, and
// the favicon is small enough that padding is mostly wasted pixels.
const TARGETS = [
  { file: "icons/icon-512.png", size: 512, fill: 0.62 },
  { file: "icons/icon-192.png", size: 192, fill: 0.76 },
];
const ICO_SIZES = [16, 32, 48];
const ICO_FILL = 0.86;

const sharp = await loadSharp("generate-icons.mjs");
const svg = await logoSvg();

/** The mark centred on a cream square, as PNG bytes. */
async function icon(size, fill) {
  const height = Math.round(size * fill);
  // Rendered from the SVG at final size rather than resized from one raster,
  // so the small icons get their own hinting-free but correctly sampled edges.
  const mark = await sharp(svg)
    .resize({ height, fit: "inside" })
    .toBuffer({ resolveWithObject: true });

  return sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
    .composite([
      {
        input: mark.data,
        left: Math.round((size - mark.info.width) / 2),
        top: Math.round((size - mark.info.height) / 2),
      },
    ])
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
}

/**
 * Packs PNGs into an .ico. Every browser that still reads .ico at all accepts
 * PNG-compressed entries, and they are a third the size of the BMP form.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size: 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

await mkdir(join(PUBLIC_DIR, "icons"), { recursive: true });

for (const target of TARGETS) {
  await writeFile(join(PUBLIC_DIR, target.file), await icon(target.size, target.fill));
  console.log(`Wrote apps/web/public/${target.file}`);
}

const frames = [];
for (const size of ICO_SIZES) frames.push({ size, data: await icon(size, ICO_FILL) });
await writeFile(join(PUBLIC_DIR, "favicon.ico"), ico(frames));
console.log(`Wrote apps/web/public/favicon.ico (${ICO_SIZES.join(", ")}px)`);
