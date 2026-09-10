/*
 * The segmented control.
 *
 * One exclusive choice out of two to five peers, all of them visible at once —
 * the kind filter on the Shelf, the tab strip in Settings, the range picker on
 * Stats. It replaces the row of independently-filling pills each of those had
 * built for itself.
 *
 * Two things make it the platform's control rather than a restyled pill row:
 *
 *   The thumb slides. There is one raised surface and it moves to the option
 *   you picked, which is the only animation in the component and the only place
 *   its state lives. Four pills filling and emptying in place say the same
 *   thing and say it as a jump cut.
 *
 *   The options are equal-width columns. A segmented control is a fixed piece
 *   of furniture — the selection changes, the geometry doesn't — so the thumb's
 *   position is arithmetic (`index * 100%` of a `100/count` percent slot) and
 *   nothing is measured. No ResizeObserver, nothing to re-measure on rotation,
 *   and it is correct in the first frame after a hydration.
 *
 * Shape and paint are in `src/index.css` (`.segmented`); this file owns the
 * geometry and the semantics.
 */

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /**
   * What the option announces, where the visible label isn't the whole story —
   * "Shows, 12 titles". The visible label has to be a prefix of it, which is
   * what SC 2.5.3 asks of any control whose name is longer than its text.
   */
  ariaLabel?: string;
  /** Selectable but empty — dimmed, and skipped by the keyboard. */
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group. A control with three unnamed toggles in it is three unnamed toggles. */
  label: string;
  className?: string;
}) {
  const index = options.findIndex((option) => option.value === value);

  return (
    /*
     * A named group of toggle buttons, not a `tablist`.
     *
     * The ARIA tabs pattern is a promise of a roving tabindex, arrow-key
     * navigation and a `tabpanel` each tab controls. This has none of them, and
     * the Shelf's filter could not honestly have the third: it filters two
     * sections at once, so there is no single panel to point at. `aria-pressed`
     * is what these actually are, and it announces the selected state without
     * claiming a keyboard contract that isn't here.
     */
    <div role="group" aria-label={label} className={`segmented ${className}`}>
      {/*
       * Hidden from assistive tech and from the layout both: the thumb is the
       * visual form of `aria-pressed`, and it is positioned rather than laid
       * out so it can't push the options it sits behind.
       *
       * Held off-screen rather than unmounted when nothing matches (a filter
       * the URL named that no longer exists), so the first real selection
       * slides in from the edge rather than appearing under the option.
       */}
      <span
        aria-hidden="true"
        className="segmented-thumb"
        style={{
          // The track's 2px padding is inside the percentage — an absolutely
          // positioned child measures against the padding box — so it comes off
          // the total before the slot is divided out, not after.
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index < 0 ? -110 : index * 100}%)`,
          opacity: index < 0 ? 0 : 1,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.ariaLabel}
            // A selected option is never disabled: the control would then have
            // no way back to itself, and the dimming would read as a fault.
            disabled={option.disabled && !selected}
            onClick={() => onChange(option.value)}
            className="segmented-option tap-target truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-ring-offset"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
