/**
 * The element at `index`, or a failure that names what was missing.
 *
 * `noUncheckedIndexedAccess` types every array lookup as `| undefined`, which
 * in a test is almost always a fact the test has just established — the request
 * was made, the row was rendered. Asserting it with `!` turns a wrong
 * expectation into "cannot read properties of undefined" with no clue which
 * lookup failed; this says which, and reads as an assertion rather than a
 * silencing.
 */
export function at<T>(items: ArrayLike<T>, index: number, what: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected ${what} at index ${index}, but there ${items.length === 1 ? "was" : "were"} ${items.length}`);
  }
  return item;
}

/** The first element, or a failure that names what was missing. */
export function first<T>(items: ArrayLike<T>, what: string): T {
  return at(items, 0, what);
}

/** Narrows a value whose presence the test has just established. */
export function present<T>(value: T | undefined | null, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what} to be present`);
  return value;
}
