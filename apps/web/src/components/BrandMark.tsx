/**
 * The Cataloggy mark: a cat curled into a C around a play button.
 *
 * Inline rather than `<img src="/logo.svg">` so the cat's ink can follow the
 * current text colour — the mark sits on a near-white page in the light theme
 * and a near-black one in the dark and glass themes, and a single fixed ink
 * would disappear into one of them. The play disc keeps the brand amber in
 * every theme; it is the one colour the mark is recognised by.
 *
 * The geometry is duplicated in `public/logo.svg`, which is what the browser
 * tab, the PWA manifest and the icon generators read. Change one, change both.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      // Every lockup in the app pairs the mark with the word "Cataloggy", so by
      // default it is decoration a screen reader should skip. `title` is for
      // the places that stand alone.
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path fill="#e8ab2b" fillRule="evenodd" d="M54.18 44.7 C49.79 45.42 45.7 47.41 42.75 50.27 C37.48 55.38 35.61 63.55 38.08 70.62 C39.85 75.69 43.95 80.22 48.63 82.28 C53.01 84.21 57.67 84.62 62.04 83.47 C65.82 82.48 67.83 80.69 68.96 77.29 C70.03 74.1 71.99 72.21 75.14 71.32 C75.66 71.17 76.12 71.02 76.14 71 C76.31 70.83 76.93 68.03 77.12 66.59 C78.3 57.24 72.49 48 63.76 45.35 C61.22 44.58 56.77 44.28 54.18 44.7 M51.51 53.64 C50.59 54.21 50.62 53.91 50.62 64.01 C50.62 73.94 50.59 73.59 51.4 74.22 C51.66 74.43 51.97 74.51 52.46 74.51 C53.21 74.51 52.7 74.8 64.56 67.72 C68.14 65.58 68.43 65.38 68.7 64.83 C69.03 64.14 68.97 63.5 68.51 62.93 C68.34 62.72 66.83 61.72 65.15 60.7 C63.46 59.69 60.62 57.96 58.82 56.86 C53.36 53.54 53.26 53.48 52.57 53.42 C52.12 53.38 51.82 53.44 51.51 53.64" />
      <path fill="currentColor" fillRule="evenodd" d="M35.95 0.72 C34.55 1.23 33.47 3.53 32.56 8.01 C31.89 11.25 31.69 13.33 31.64 17.24 L31.59 20.78 30.87 22.37 C29.49 25.44 28.7 28.44 28.31 32.04 C28.19 33.19 28.06 34.32 28.03 34.56 C27.98 34.82 27.58 35.44 26.97 36.16 C19.21 45.33 16.23 56.02 18.18 67.7 C21 84.61 34.85 97.48 51.87 98.99 C63.25 100 74.67 95.53 80.38 87.83 C82.05 85.57 83.21 82.89 83.37 80.88 C83.77 75.86 79.14 72.45 74.71 74.51 C73.08 75.27 72.08 76.48 71.32 78.61 C69.82 82.88 66.34 85.56 60.72 86.77 C58.86 87.18 54.72 87.21 52.77 86.83 C45.33 85.4 39.41 80.89 36.16 74.16 C34.4 70.53 33.53 66 33.93 62.5 C34.99 53.1 41 45.78 50.06 42.84 C52.83 41.95 53.98 41.78 57.43 41.78 C61.6 41.78 64.34 42.34 67.86 43.9 C69.64 44.7 70.42 44.75 71.58 44.16 C72.97 43.44 75.22 41.02 76.04 39.37 C76.5 38.44 76.2 38.37 80.95 40.49 C81.56 40.76 81.62 40.77 81.96 40.54 C82.31 40.31 82.44 39.75 82.21 39.39 C82.09 39.2 80.46 38.44 78.49 37.65 C77.73 37.34 77.08 37.07 77.06 37.05 C77.03 37.03 77.08 36.74 77.17 36.42 L77.33 35.84 78.33 35.93 C78.88 35.98 80.12 36.11 81.09 36.23 C83.26 36.49 83.55 36.39 83.43 35.45 C83.36 34.9 82.2 34.62 79.12 34.4 C78.35 34.35 77.7 34.26 77.68 34.22 C77.65 34.17 77.66 33.87 77.69 33.56 L77.75 32.99 78.82 32.76 C79.4 32.64 80.54 32.43 81.34 32.31 C82.84 32.07 83.29 31.84 83.29 31.29 C83.29 30.51 82.48 30.43 79.73 30.94 C78.68 31.13 77.81 31.27 77.79 31.25 C77.77 31.23 77.66 30.4 77.53 29.41 C76.97 25.01 75.66 21.78 73.03 18.36 L72.12 17.18 72.63 14.53 C73.34 10.88 73.55 9.21 73.65 6.53 C73.73 4.39 73.71 4.18 73.44 3.57 C73.09 2.77 72.44 2.43 71.51 2.56 C70.01 2.76 66.07 5.34 62.27 8.61 C61.22 9.51 61.04 9.73 61.34 9.73 C61.66 9.73 64.1 11 65.32 11.81 C66.63 12.66 68.98 14.78 68.81 14.94 C68.76 14.99 68.2 14.75 67.56 14.41 C62.91 11.9 55.98 10.48 50.76 10.96 C49.15 11.1 48.97 11.06 48.41 10.38 C48.21 10.14 47.2 9.01 46.16 7.86 C40.99 2.16 37.91 0 35.95 0.72 M71.32 24.36 C69.82 25.35 69.7 29.02 71.12 30.52 C72.6 32.1 74.51 29.6 73.98 26.75 C73.71 25.26 72.83 24.05 72.03 24.05 C71.9 24.05 71.58 24.19 71.32 24.36 M54.72 24.4 C53.81 24.89 53.4 25.53 53.12 26.89 C52.29 30.94 56.04 33.51 57.81 30.11 C58.37 29.04 58.37 26.98 57.8 25.82 C57.12 24.44 55.79 23.82 54.72 24.4 M65.21 32.28 C63.57 32.64 63.69 33.35 65.8 35.55 C66.86 36.66 67.26 36.54 68.52 34.72 C69.38 33.47 69.49 33.11 69.15 32.68 C68.72 32.16 66.71 31.95 65.21 32.28 M44.33 33.18 C44.19 33.33 44.09 33.62 44.09 33.82 C44.09 34.47 44.47 34.58 47.21 34.67 C48.59 34.72 50.24 34.84 50.87 34.94 C52.15 35.14 52.52 35.05 52.72 34.51 C53.06 33.59 51.32 33.12 47 32.99 C44.72 32.92 44.56 32.93 44.33 33.18 M50.27 37.18 C48.64 37.59 45.97 38.51 45.21 38.92 C44.64 39.22 44.72 40.19 45.33 40.38 C45.49 40.43 46.31 40.21 47.33 39.84 C48.28 39.49 49.87 38.99 50.85 38.71 C51.83 38.44 52.71 38.11 52.81 37.99 C53.08 37.64 53.01 37.16 52.67 36.92 C52.29 36.65 52.42 36.63 50.27 37.18" />
    </svg>
  );
}

/**
 * The wordmark's type, wherever it sits beside the mark.
 *
 * Heavier and tighter than anything else in the app on purpose: at the UI's own
 * `font-bold` and default tracking, "Cataloggy" is set identically to a page
 * heading like "Games" or "Calendar", and the eye reads it as one more label
 * rather than as the product's name. 800 with tracking pulled in is the smallest
 * change that makes it a wordmark. Size stays with the caller — it ranges from
 * the 16px sidebar rail to the 30px first-run splash.
 */
export const BRAND_WORDMARK = "font-extrabold tracking-tight";

/** Carried over from the old logo art, which had it set under the name. */
const TAGLINE = "Track your movies & shows";

/**
 * The stacked lockup, for the two screens that are nothing but brand: first run
 * and the profile picker. Centred, mark above the name, tagline underneath.
 *
 * The tagline is doing structural work as much as it is saying anything — it
 * gives the name a base to sit on, so a tall mark over a single short word
 * stops reading as two things that happen to be near each other.
 */
export function BrandLockup() {
  return (
    <div className="flex flex-col items-center text-center">
      <BrandMark className="h-16 w-16" />
      <span className={`mt-3 text-3xl ${BRAND_WORDMARK}`} style={{ color: "var(--text)" }}>
        Cataloggy
      </span>
      <span
        className="mt-1.5 text-2xs font-semibold uppercase tracking-[0.2em]"
        style={{ color: "var(--text-mute)" }}
      >
        {TAGLINE}
      </span>
    </div>
  );
}
