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
 * The extra weight and the pulled-in tracking are what separate a title from a
 * merely large label — at `font-bold` and default tracking, "Watch Statistics"
 * is set the same as a button. Only one of these should be visible at a time;
 * if a screen wants two, one of them is a `SECTION_TITLE`.
 */
export const PAGE_TITLE = "font-heading text-2xl font-extrabold tracking-tight";

/**
 * The header of a card, a panel, a modal or a run of content under a page title.
 *
 * A step down in size from `PAGE_TITLE` and a step down in weight, so the two
 * never compete, but still on the heading face with tracking in — a section
 * header is structure, and it should read as the same family of type as the
 * title above it rather than as bolded body copy.
 */
export const SECTION_TITLE = "font-heading text-lg font-bold tracking-tight";

/**
 * The uppercase label that names a block inside a panel — "Overview", "Cast",
 * "Now Watching", "Seasons".
 *
 * Uppercase and small rather than large and bold, because these appear several
 * to a panel: at heading size they would out-shout the title they sit under.
 * The opened-out tracking is not decoration — uppercase text at 12px is hard to
 * read set solid, and `tracking-wider` is what buys the letterforms back.
 */
export const KICKER = "text-xs font-semibold uppercase tracking-wider";

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
export const MICRO_LABEL = "text-2xs font-semibold uppercase tracking-wider";

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
