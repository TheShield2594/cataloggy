# Changelog

All notable changes to Cataloggy are documented in this file, starting from this entry onward. Earlier history predates this file — see `git log` for the full commit history.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Dates are UTC.

## [Unreleased]

### Added

- Docker images are now also published with a `sha-<short-sha>` tag (and a semver tag for `vX.Y.Z` tag pushes), so self-hosters can pin a known-good version and roll back instead of only ever running `:latest`.
- CI now applies every Prisma migration against a real Postgres service before running tests, catching broken migrations before they reach a self-hoster's `api` container.
- CI now runs CodeQL static analysis and a `pnpm audit` dependency check (weekly, plus every push/PR).
- README: guidance on pinning/rolling back image versions, and on recovering if a database migration fails on container start.
- `CONTRIBUTING.md`.
- A "Sync Status" Settings section and `GET /settings/job-status` endpoint surfacing the last failure of each scheduled background job (Trakt poll/watchlist sync, episode notifications, AI recs refresh, Steam sync, scrobble cleanup), so a self-hoster without Sentry configured can still notice a silently-broken sync.
- A visible "update available" prompt for the web PWA instead of the service worker silently swapping itself in.
- `PATCH /profiles/:id` for renaming a profile or setting/changing/removing its PIN, plus a Settings UI to do so — previously only creating and switching profiles was possible from the app; deleting one (already supported server-side) had no UI entry point at all.
- Test coverage for previously-untested modules: `lib/collection.ts`, `lib/watchlist.ts`, `lib/series-progress.ts`, `routes/watch.ts`, the Plex/Jellyfin webhook handlers, and the new profile-management/job-status endpoints.

### Changed

- `docker-compose.yml` services now use `restart: unless-stopped`, so the stack recovers automatically after a host reboot or crash instead of staying down.
- `apps/addon`'s Dockerfile is now a multi-stage build (matching `apps/api`/`apps/web`), shipping a smaller runtime image without the full pnpm workspace/devDependencies.
- The web app now detects an invalid or rotated API token globally (via a `WWW-Authenticate` response header on bearer-auth failures) and returns to the setup wizard, instead of every page showing a generic "Unable to connect" error for the rest of the session.
- The Stremio addon's mark-watched/scrobble endpoints now require a token derived from the shared API token, instead of relying solely on a spoofable `Origin` header check.
- TMDB and Trakt API calls now time out after 10s, matching the existing IGDB/Steam client behavior, instead of hanging indefinitely on a slow/unresponsive upstream.

### Fixed

- `/search` no longer throws an uncaught exception (and a bare 500) when the upstream TMDB request fails.
- Bumped a transitive `serialize-javascript` dependency (via `workbox-build`) to patch a high-severity RCE advisory ([GHSA-5c6j-r48x-rmvq](https://github.com/advisories/GHSA-5c6j-r48x-rmvq)).
- `getDefaultWatchlist` now retries on a concurrent-create race instead of throwing a raw Prisma error (matching `getDefaultCollection`'s existing behavior).
