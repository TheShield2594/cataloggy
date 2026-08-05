import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A native `<select>` wearing the app's own chevron.
 *
 * Every select in the app used to arrive with the OS chevron and the OS focus
 * ring beside controls we draw ourselves — the clearest "unfinished" tell in
 * the interface. The search page had already solved it (reset the appearance,
 * overlay a real lucide `ChevronDown`, `pointer-events-none` so clicks still
 * reach the select); this is that pattern extracted so the other four call
 * sites get it too, and so the next one gets it for free.
 *
 * Still a native select: it keeps the platform's open behaviour, type-ahead,
 * keyboard handling and mobile picker, none of which a custom listbox gets
 * without rebuilding all four.
 *
 * `className` goes to the select (size, radius, layout — deliberately
 * per-site; see the .select-control note in index.css), `wrapperClassName` to
 * the positioning context the chevron is placed against, which is where a
 * `w-full` or `flex-1` belongs.
 */
export function SelectField({
  className = "",
  wrapperClassName = "",
  chevronSize = 14,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
  /** Match the chevron to the control: 14px for compact selects, 16px for full-width fields. */
  chevronSize?: number;
}) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select className={`select-control ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        style={{ width: chevronSize, height: chevronSize, color: "var(--text-mute)" }}
      />
    </div>
  );
}
