/*
 * Reading a boolean out of an environment variable.
 *
 * Three services had each compared the raw variable against the string
 * "true" inline, which quietly means `1`, `TRUE` and `yes` are all "off".
 * Every one of those variables is an opt-in switch documented as `=true`, so
 * the failure mode was the bad one: a self-hoster who wrote
 * `STREMIO_PLAY_DETECTION=1`, restarted, and got no error and no feature —
 * nothing to search for, and nothing in the logs to search with.
 *
 * The example above is spelled out in prose rather than as code, deliberately:
 * `scripts/check-compose-env.mjs` scans source for environment reads without
 * stripping comments first, so a literal one here would be reported as a real
 * variable missing from docker-compose.yml.
 */

/** Spellings that mean yes. Compared lowercased and trimmed. */
const TRUTHY = new Set(["true", "1", "yes", "y", "on"]);

/** Spellings that mean no. Anything else is neither, and takes the default. */
const FALSY = new Set(["false", "0", "no", "n", "off", ""]);

/**
 * Whether `value` reads as true.
 *
 * Unset, empty and unrecognised all fall through to `fallback`, so a typo lands
 * on the documented default rather than silently flipping a switch. Callers
 * that need to tell "unrecognised" from "explicitly false" should use
 * `parseBoolStrict`.
 */
export function parseBool(value: string | undefined | null, fallback = false): boolean {
  return parseBoolStrict(value) ?? fallback;
}

/** As `parseBool`, but `null` for a value that says neither yes nor no. */
export function parseBoolStrict(value: string | undefined | null): boolean | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return null;
}
