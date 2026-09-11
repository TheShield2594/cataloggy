/**
 * What a profile looks like when it has no picture — which is every profile,
 * since Cataloggy has never had anywhere to upload one.
 *
 * Two byte-identical copies of this lived in `ProfileSwitcher.tsx` and
 * `settings/ProfileSettings.tsx`, which is two places for a colour to drift and
 * for the same profile to be drawn in two different ones on two screens.
 */

const AVATAR_COLORS: [string, ...string[]] = [
  "#f97316",
  "#0ea5e9",
  "#a855f7",
  "#22c55e",
  "#ec4899",
  "#eab308",
];

/**
 * A stable colour for `name`, picked from a small palette.
 *
 * Derived rather than stored: a profile is a name and nothing else, so there is
 * no field to keep a choice in, and hashing the name means the same profile is
 * the same colour on every device without anything being synced.
 */
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** The letters drawn inside the circle. */
export function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}
