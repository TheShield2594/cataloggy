/**
 * Reading a `YYYY-MM-DD` date the API sent.
 *
 * Four callers wrote `const [y, m, d] = value.split("-").map(Number)` and used
 * the three results as numbers. That binds `undefined` for anything that is not
 * three parts — a bare year, an empty string, a TMDB partial date — and what
 * happens next depends on where the result lands: `new Date(NaN, NaN, NaN)` is
 * an Invalid Date that renders as the words "Invalid Date", while
 * `new Date(Date.UTC(undefined as never, …)).toISOString()` *throws* a
 * RangeError out of an onClick handler with nothing to catch it.
 *
 * So the parse returns null for anything it cannot read, and each caller says
 * what it wants to happen instead.
 */

/**
 * Local midnight on `value`, or null when it is not a `YYYY-MM-DD` date.
 *
 * Local rather than UTC on purpose: these are dates a person compares against
 * "today" in the place they are sitting, and an air date is a calendar day, not
 * an instant.
 */
export function localDateFromIsoDate(value: string): Date | null {
  const parts = isoDateParts(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

/**
 * Noon UTC on `value` as an ISO instant, or null when it is not a
 * `YYYY-MM-DD` date.
 *
 * Noon rather than midnight so that the day survives being read back in any
 * time zone: midnight UTC is the previous day everywhere west of Greenwich,
 * which would file a watch under the wrong date for most of the Americas.
 */
export function utcNoonIsoFromIsoDate(value: string): string | null {
  const parts = isoDateParts(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString();
}

function isoDateParts(value: string): [number, number, number] | null {
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return [year, month, day];
}
