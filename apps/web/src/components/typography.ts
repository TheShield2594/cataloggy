/**
 * The app's heading scale, as four class strings.
 *
 * These exist for the same reason `BRAND_WORDMARK` does: a heading's type is a
 * decision about the product, not about the screen it happens to sit on, so it
 * belongs in one place that every screen reads from. Before this file the same
 * four roles were spelled eleven different ways — page titles were `text-2xl
 * font-bold` on six pages but `font-heading text-2xl font-extrabold
 * tracking-tight` on the hero and the detail panels, section headers were
 * `font-bold` on the dashboard, `font-semibold` on stats and a size smaller
 * again in settings, and the uppercase labels drifted across four size/weight
 * pairs, twice within a single panel.
 *
 * Each constant carries size, weight and tracking together, because those three
 * are what make a tier recognisable — splitting them is how the drift started.
 * Colour stays with the caller: the same tier is `--text` on a page, `--text-mute`
 * over a poster and `--accent-text` on a live badge.
 *
 * Four tiers, loudest first.
 */

/**
 * The loudest thing on a screen: page `h1`s, and the title of whatever a panel
 * or an empty state has been opened to show.
 *
 * Size is what separates a title from a merely large label, not weight: this is
 * the platform's large title — 34px at `sm` and up, 28px on a phone, where 34
 * over a 375px column leaves "Watch Statistics" nowhere to break. Tracking goes
 * *out* slightly at the large size and in at the small one, which is what the
 * system face does across the same range.
 *
 * Only one of these should be visible at a time; if a screen wants two, one of
 * them is a `SECTION_TITLE`.
 */
export const PAGE_TITLE =
  "text-[1.75rem] font-bold leading-[1.15] tracking-[-0.01em] sm:text-[2.125rem] sm:leading-[1.2] sm:tracking-[0.01em]";

/**
 * The header of a card, a panel, a modal or a run of content under a page title.
 *
 * 22px bold — the platform's title2, and the size a section header takes above
 * a shelf of cards. A clear step down from the large title so the two never
 * compete, and clearly not body copy: at 17px a bold line reads as an emphatic
 * sentence rather than as the name of what is under it.
 */
export const SECTION_TITLE = "text-[1.375rem] font-bold leading-tight tracking-[-0.01em]";

/**
 * The uppercase label that names a block inside a panel — "Overview", "Cast",
 * "Now Watching", "Seasons".
 *
 * Uppercase and small rather than large and bold, because these appear several
 * to a panel: at heading size they would out-shout the title they sit under.
 * The opened-out tracking is not decoration — uppercase set solid is hard to
 * read, and this is what buys the letterforms back. It is a good deal tighter
 * than the 0.1em these ran at while they were set in mono: that spacing was
 * answering a face the app no longer uses.
 */
export const KICKER = "text-[0.8125rem] font-semibold uppercase tracking-[0.04em]";

/**
 * The same idea one notch quieter: form-field labels, table and grid column
 * headings, the caption on a stat tile, the group headers in the command
 * palette.
 *
 * The distinction from `KICKER` is what it labels, not how loud it is — a
 * kicker names a section of content, a micro label names a single control or
 * value. Reach for this when the label sits *inside* a component rather than
 * above one.
 */
export const MICRO_LABEL = "text-2xs font-semibold uppercase tracking-[0.04em]";

/*
 * Two kinds of uppercase text deliberately sit outside this file.
 *
 * The filled badges — the "MOVIE"/"SERIES"/"PLAYING" chips on posters and panel
 * headers — are `uppercase tracking-wide` on a coloured fill. They read as a
 * shape rather than as type, and a chip's tracking has to stay tighter than a
 * label's or the pill grows wide enough to cover the artwork underneath.
 *
 * The brand tagline in `BrandLockup` runs at `tracking-[0.2em]`, far wider than
 * `MICRO_LABEL`. That is the lockup's spacing, not the UI's, and it belongs with
 * the mark it is set under.
 */
