// Profile and list identifiers are UUID v4 throughout Cataloggy. Shared so the
// api and addon services validate them identically — the addon feeds a profile
// id straight into an `x-profile-id` request header and a cache key, so a
// looser check there would be the weak link.
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
