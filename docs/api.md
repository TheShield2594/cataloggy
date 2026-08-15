# API reference

The Cataloggy API is a Fastify service on port `7000`. Everything the web UI
does goes through it, so anything here is fair game for a script, a shortcut, a
Home Assistant automation, or your own client.

This is a reference for the endpoints as they behave today. It is not a
stability promise — Cataloggy is a self-hosted app with one supported client, and
routes do change between versions. Pin `CATALOGGY_IMAGE_TAG` if you build
something on top of it.

- [Authentication](#authentication)
- [Profiles](#profiles)
- [Conventions](#conventions)
- [Endpoints](#endpoints)
  - [Health and metrics](#health-and-metrics)
  - [Search and metadata](#search-and-metadata)
  - [Discovery](#discovery)
  - [Watch history](#watch-history)
  - [Series progress](#series-progress)
  - [Check-in and scrobbling](#check-in-and-scrobbling)
  - [Ratings](#ratings)
  - [Lists](#lists)
  - [Tags](#tags)
  - [Calendar](#calendar)
  - [Games](#games)
  - [Profiles API](#profiles-api)
  - [Settings and API keys](#settings-and-api-keys)
  - [AI recommendations](#ai-recommendations)
  - [Trakt](#trakt)
  - [Stremio library](#stremio-library)
  - [Stremio add-on](#stremio-add-on)
  - [Push notifications](#push-notifications)
  - [Notification channels](#notification-channels)
  - [Export and import](#export-and-import)
  - [Webhooks](#webhooks)

## Authentication

Every endpoint needs `API_TOKEN` as a bearer token:

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://192.168.1.25:7000/watch/stats
```

A missing or wrong token gets `401` with a `WWW-Authenticate: Bearer` header.
That header is how the web client tells "your API token is wrong" apart from
other 401s (an incorrect profile PIN, for instance), so keep it in mind if you
write your own client.

Six paths are exempt, because they cannot carry a bearer token by construction:

| Path | Why it is exempt | What guards it instead |
| --- | --- | --- |
| `GET /health` | Liveness probe | Nothing — it reports no data |
| `GET /health/ready` | Readiness probe (the container healthcheck) | Nothing — it reports only whether the database answered, never why |
| `/addon/stremio/*` | Stremio sends no credentials | An unguessable per-profile secret in the path |
| `GET /addon` | Add-on discovery | As above |
| `/trakt/oauth/callback` | Browser redirect from trakt.tv | The `state` value that started the flow |
| `/webhooks/*` | Plex and Jellyfin post directly | `WEBHOOK_SECRET`, plus optional `WEBHOOK_ALLOWED_IPS` |

## Profiles

Most endpoints act on one profile's data. The profile comes from the
`x-profile-id` header:

```bash
curl -H "Authorization: Bearer $API_TOKEN" \
     -H "x-profile-id: 3f1c…" \
     http://192.168.1.25:7000/lists
```

Omit it and the default profile is used. A malformed value is a `400`, not a
silent fallback — a typo'd profile id should not quietly write to someone else's
history.

Profiles protected by a PIN also need `x-profile-token`, which
`POST /profiles/:id/verify` returns.

Anything scoped to a profile only ever sees that profile's rows. Asking for
another profile's list returns `404`, not `403` — the lookup is scoped, so the
row genuinely is not found.

## Conventions

- **Errors** are always `{ "error": "<human-readable message>" }`. Some also
  carry a `code` (`body_too_large`, `too_many_rows`) for cases where the fix is
  a specific config change.
- **Rate limits** are 200 requests/minute per IP, and 1000/minute for the add-on
  service, which authenticates with a derived service token. Credential-taking
  routes (profile PIN verification, Stremio connect, the Trakt OAuth pair) are
  limited to 10/minute on top of that.
- **Types** are `movie` and `series` almost everywhere. Watch events use `movie`
  and `episode`; tags additionally accept `episode`.
- **IDs** are IMDb ids (`tt0111161`) for films and shows, UUIDs for
  Cataloggy's own rows (lists, games, profiles, tags, watch events). Those are
  uuid columns, so a malformed id is a `400` before any query runs rather than
  an empty result.
- **Validation** rejects a request before it reaches the database, either way it
  is written: a route's JSON Schema (`lib/request-schema.ts`, which is also what
  phrases the message) runs before its handler is entered, and a route with
  explicit checks makes them first thing inside the handler. Either way the
  answer is a `400` naming the field. Types are taken as sent — a number where a
  string belongs is rejected, not coerced.
- **Caching**: `GET` responses carry an ETag. Send `If-None-Match` and you get a
  `304` with no body. Responses over 1 KB are compressed (`br`, `gzip`,
  `deflate`).
- **Body size** is capped by `MAX_BODY_SIZE_MB` (default 32, allowed range
  1–1024). This is the whole request body, so restoring a large backup is the
  case that hits it; the `413` says so. Row counts are a separate, per-route
  limit — see [Export and import](#export-and-import).

## Endpoints

### Health and metrics

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness: `{ status, service }`. No auth, and no database — it keeps answering 200 during an outage, because restarting the container would not fix one. |
| `GET` | `/health/ready` | Readiness: `SELECT 1` with a two-second deadline. `200` with `{ status, service, database: { ok, latencyMs } }`, or `503` when the database does not answer — which is also what an exhausted connection pool looks like. No auth; the failing body says only that the database did not answer, never why. This is what the `api` container's Docker healthcheck uses. |
| `GET` | `/metrics` | Needs the token. Per-process counters as JSON: `uptimeSeconds`, `memory`, `requests` (total, by status class, and per route template with count/failures/total/max/average duration), `upstream` (the same per outbound hostname), `database` (the readiness probe, with its error), and `jobs` — the last run of every scheduled background job, the same rows Settings → Sync Status shows. Counters reset when the process does. `jobs` is `null` with `jobsError` set when the database is down, so the rest still answers. |

### Search and metadata

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/search?q=&type=` | `type` is `movie`, `series` or `all` (default). `query` works as an alias for `q`. Max 20 results, best title match first, each flagged with `inWatchlist` / `inCollection` / `lists`. `q` also takes an IMDb id (`tt0110912`) or a themoviedb.org link, which resolve to that one title. A query matching no title is retried as a person, and answers with what they are known for. |
| `GET` | `/meta/:type/:imdbId` | Full metadata for one title. |
| `GET` | `/meta/:type/:imdbId/bundle` | Everything the detail panel needs — meta, cast, providers, recommendations, seasons, dropped state — in one round trip. Optional sections degrade to empty rather than failing the response. |
| `GET` | `/meta/:type/:imdbId/cast` | Cast and director. |
| `GET` | `/meta/:type/:imdbId/providers` | Where to stream it, for the configured region. |
| `GET` | `/meta/series/:imdbId/seasons` | Season list. |
| `GET` | `/meta/series/:imdbId/season/:seasonNumber/episodes` | Episodes for one season; `seasonNumber` must be a positive integer. Fetched on demand as a season is expanded. |
| `POST` | `/metadata/sync` | `{ imdbId, type }` — refresh one title from TMDB. |
| `POST` | `/metadata/refresh-all?limit=` | Re-fetch stored metadata in batches of 5. `limit` defaults to 50, caps at 500. |
| `GET` | `/metadata/anime-search?q=` | AniList search. |
| `GET` | `/genres` | Every genre present in your stored metadata. |

### Discovery

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/trending?type=&window=` | `window` is `day` or `week` (default). |
| `GET` | `/popular?type=` | |
| `GET` | `/streaming?provider=&type=&region=` | Provider key from `/streaming/providers`. `region` falls back to the stored setting. |
| `GET` | `/streaming/providers` | The nine supported providers and their TMDB ids. |
| `GET` | `/anime?type=` | Anime discovery, `series` by default. |
| `GET` | `/recommendations?imdbId=&type=` | Similar titles to one title. |
| `GET` | `/recommendations/personal?type=&limit=` | Seeded from your recent watches. Uses the AI provider when one is configured, TMDB otherwise. `limit` caps at 40. |

Discovery responses are cached in memory and returned as Stremio meta previews
(`{ id, type, name, poster, year, description, genres, rating }`).

### Watch history

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/watch` | Record a watch. `{ type: "movie" \| "episode", imdbId, seriesImdbId?, season?, episode?, watchedAt?, dateUnknown?, note? }`. `note` is capped at 2,000 characters. |
| `GET` | `/watch/history?limit=&offset=&imdbId=&type=` | `limit` is 1–200, default 50. `type` is `movie` or `episode`; anything else is a `400` rather than a silently unfiltered page. Filtering happens server-side so it searches every row, not just the loaded page. |
| `PATCH` | `/watch/:eventId` | `{ note }` — sets or clears the note on an existing watch (`null`, or a blank string, clears it), capped at 2,000 characters like `POST /watch`. It does not move the watch date. |
| `DELETE` | `/watch/:eventId` | Deleting an episode rewinds series progress to the next-latest episode watched, or clears the progress row when none is left. |
| `GET` | `/watch/stats` | Headline counts. |
| `GET` | `/watch/stats/detailed` | Genres, runtime, patterns over time. |
| `GET` | `/watch/stats/year/:year` | Year in Review. |

### Series progress

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/series/progress` | Every show in flight. |
| `GET` | `/series/progress/:imdbId` | One show. |
| `GET` | `/series/:imdbId/watched-episodes` | |
| `POST` | `/series/:imdbId/watch-next` | Mark the next unwatched episode. |
| `POST` | `/series/:imdbId/season/:seasonNumber/episode/:episodeNumber/watch` | |
| `DELETE` | `/series/:imdbId/season/:seasonNumber/episode/:episodeNumber/watch` | |
| `POST` | `/series/:imdbId/season/:seasonNumber/watch-all` | |
| `GET` | `/show/:imdbId/dropped` | |
| `POST` | `/show/:imdbId/drop` | Hide a show from Continue Watching without deleting its history. |
| `DELETE` | `/show/:imdbId/drop` | Un-drop. |

### Check-in and scrobbling

Check-ins are manual ("I'm watching this now"); scrobble sessions are what the
Plex and Jellyfin webhooks drive.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/checkin` | The current check-in, if any. |
| `POST` | `/checkin` | `{ type, imdbId, name, poster?, seriesImdbId?, season?, episode?, runtime? }`. `runtime` is in **minutes** (1–1440), and sets an expiry that far ahead so an abandoned check-in clears itself. `name` is capped at 300 characters and `poster` at 2,048. |
| `DELETE` | `/checkin?log=` | Clears the check-in. `?log=true` records a watch event from it first — that is the "finished watching" action, where the bare call is "cancel". A failure to record still clears the check-in. |
| `GET` | `/scrobble/now-playing` | |
| `POST` | `/scrobble/start` \| `/scrobble/pause` \| `/scrobble/stop` | Stale sessions are swept periodically. |

### Ratings

Five stars, stored as 1–10 so half-stars survive a round trip.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/ratings?type=&limit=&imdbId=` | `limit` is 1–200, default 50. Filtering by `imdbId` drops the limit entirely, so a show's episode ratings come back whole rather than truncated to the most recent. |
| `POST` | `/ratings` | `{ imdbId, type, rating, season?, episode?, note? }`. `type` is `movie`, `series`, `season` or `episode`. |
| `GET` | `/ratings/:type/:imdbId?season=&episode=` | |
| `DELETE` | `/ratings/:type/:imdbId?season=&episode=` | |

Seasons are their own rating type rather than a series row carrying a season
number — otherwise a Specials (season 0) rating would overwrite the show's own.

### Lists

Three kinds: `watchlist`, `collection`, `custom`. A default watchlist and
collection are created on first start; the watchlist is the one that mirrors to
Trakt.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/lists` | Each list with its item count. |
| `POST` | `/lists` | `{ name, kind }`. `400` for a kind that isn't one of the three; `409` for `watchlist` or `collection`, which are per-profile singletons the app creates for you — only `custom` can be created here. |
| `PATCH` | `/lists/:id` | `{ name }`. Renaming a default list is allowed — both defaults are looked up by kind, not by name. |
| `DELETE` | `/lists/:id` | `409` for the default watchlist or collection — items cascade off the list, so deleting one takes its contents with it. The default is the oldest row of its kind, so a duplicate left by an older version is still deletable. |
| `GET` | `/lists/:listId/items` | Items with metadata joined; anything still missing metadata falls back to the title captured when it was added, and a backfill is queued. |
| `POST` | `/lists/:listId/items` | `{ type, imdbId, title? }`. `409` if already present. |
| `DELETE` | `/lists/:listId/items/:type/:imdbId` | |
| `DELETE` | `/lists/:listId/items/:imdbId?type=` | Infers the type when only one item matches; `400` asking for `?type=` when a movie and a series share the id. |
| `GET` | `/items/:imdbId/lists?type=` | Which of your lists hold this title. |

### Tags

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tags` | All tags with counts. |
| `GET` | `/tags?type=&imdbId=` | Tags on one item. Both params or neither. |
| `POST` | `/tags` | `{ name }`, max 50 chars. Returns the existing tag if the name is taken. |
| `DELETE` | `/tags/:tagId` | Deleting a tag that doesn't exist is a no-op, not a `404`. |
| `POST` | `/tags/assign` | `{ tagName, type, imdbId }`. Creates the tag if needed; idempotent. |
| `DELETE` | `/tags/assign` | `{ tagId, type, imdbId }`. |

### Calendar

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/calendar?days=` | Upcoming episodes for shows you follow. `days` is 1–90, default 30. Respects the spoiler-protection setting. |

### Games

Needs `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` for search, and
`STEAM_API_KEY` / `STEAM_ID` for library sync.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/games?sort=` | `recent` (default), `playtime` or `rating`. |
| `GET` | `/games/search?q=` | IGDB search, each result flagged `inLibrary`. |
| `POST` | `/games` | `{ igdbId, title, coverUrl?, releaseDate?, genres? }`. `409` if already held. |
| `PATCH` | `/games/:id` | `{ rating?, notes?, finished?, finishedAt? }`. Marking `finished` stamps today unless a date is given; un-marking clears it. |
| `DELETE` | `/games/:id` | |
| `GET` | `/games/steam/status` | Reports `configured: true` even if the player-summary lookup fails — the summary is display only. |
| `POST` | `/games/steam/sync` | Syncs into the calling profile. |

### Profiles API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/profiles` | |
| `POST` | `/profiles` | `{ name, pin? }`. A PIN is 4–128 characters. |
| `PATCH` | `/profiles/:id` | `{ name?, pin? }`. Changing or clearing an existing PIN also needs `currentPin`; `pin: null` removes it. A *first* PIN has nothing to prove, so it is instead only accepted for the profile the caller is acting as (`x-profile-id`, or the only profile on a single-profile install) — `403 profile_not_active` otherwise. Without that, one PIN could lock a household member out of their own profile. |
| `DELETE` | `/profiles/:id` | |
| `POST` | `/profiles/:id/verify` | `{ pin }` → a profile token for `x-profile-token`. `401` on a wrong PIN, `429` once the profile is locked out after repeated failures — separate from the global rate limit. |

### Settings and API keys

Keys saved here take precedence over the matching environment variable, so a
rotated key doesn't mean editing `.env` and restarting.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/settings/preferences` | Language, region, spoiler protection, and the provider catalogue. |
| `POST` | `/settings/preferences` | `{ language?, region?, spoilerProtection? }`. Language is `en` or `en-US` shaped; region is two letters. Both are normalized. Clears the discovery cache. |
| `GET` | `/settings/job-status` | Background jobs that are currently failing — the Steam sync, Trakt poll, episode notifications, AI refresh. Otherwise these are only visible in the logs. |
| `GET` | `/tmdb/status` | `{ configured, source }` where source is `db`, `env` or `none`. |
| `POST` | `/tmdb/key` | Validated against TMDB before saving, so a typo can't overwrite a working key. |
| `DELETE` | `/tmdb/key` | Reports the env fallback that remains, if any. |
| `GET` | `/omdb/status` | `{ configured }`. |
| `POST` | `/omdb/key` | Validated against OMDb before saving; its own error text is passed through. Posting an empty key deletes the stored one and returns `{ configured: false }`. |
| `DELETE` | `/omdb/key` | |
| `GET` | `/rpdb/status` | `{ configured, hasKey }`. |
| `POST` | `/rpdb/key` | Not validated on save — RPDB has no cheap check, so a bad key shows up as missing posters rather than an error here. Posting an empty key deletes the stored one. |
| `DELETE` | `/rpdb/key` | |
| `GET` | `/rpdb/config` | Used by the add-on service, which needs the key to build poster URLs itself. There is no per-title poster endpoint: everywhere else the API substitutes RPDB posters into the metadata it already returns. This is the one route that hands a stored third-party key back out, so it takes the add-on's service token and 404s for anything else — a browser holds `API_TOKEN` too. `/rpdb/status` is what Settings reads. |

### AI recommendations

Any OpenAI-compatible chat-completions endpoint, including a local one.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/ai/config` | Headers are redacted. Includes `lastGeneratedAt`. |
| `POST` | `/ai/config` | `{ config: { url, headers, payload: { model, max_tokens? } } }`. `max_tokens` below 2048 is clamped up — under that, responses truncate mid-JSON. |
| `DELETE` | `/ai/config` | |
| `POST` | `/ai/test` | Sends one trivial prompt. Reports the status code on failure and never the upstream body, so it can't be used as an SSRF probe. Redirects are not followed. |
| `GET` | `/recommendations/ai?type=&limit=` | With reasons per title. Falls back to TMDB seeds when no provider is configured. `limit` caps at 20. |
| `POST` | `/recommendations/ai/refresh` | Drops the cached set; the next request regenerates. |

URLs are checked twice: syntactically on save, and against DNS immediately
before each outbound request — records can change after a config is saved.

### Trakt

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/trakt/status` | |
| `GET` | `/trakt/oauth/authorize` | Starts the flow. |
| `GET` | `/trakt/oauth/callback` | The redirect target. No bearer token; bound to the flow by `state`. |
| `POST` | `/trakt/import` | One-time history import. `409` if an import is already running. |
| `POST` | `/trakt/poll` | Run the scheduled poll now. |
| `POST` | `/trakt/disconnect` | |

### Stremio library

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/stremio/library/status` | |
| `POST` | `/stremio/library/connect` | `{ email, password }`. Takes a baseline without recording history, so connecting an account with years of history doesn't backdate a flood of watch events. If the baseline fails the connection is undone — a connection with no baseline would make the next incremental pass treat the whole library as newly watched. |
| `POST` | `/stremio/library/import` | The opt-in backfill, dated from Stremio's own `lastWatched`. |
| `POST` | `/stremio/library/sync` | The incremental pass, on demand. |
| `POST` | `/stremio/library/disconnect` | |
| `POST` | `/stremio/play-signal` | Written by the add-on service, and only by it: the profile id picks which profile a signal is written to, so the route takes the add-on's service token and 404s for anything else. The id may come as `x-profile-id` (what the add-on sends) or in the body, and is validated rather than trusted either way; absent both, the default profile. |
| `GET` | `/stremio/play-signals` | Diagnostics: what the add-on has seen but not yet acted on. |

### Stremio add-on

These serve Stremio clients directly. The `:secret` variants are the per-profile
URLs; the unprefixed ones use the default profile.

| Method | Path |
| --- | --- |
| `GET` | `/addon/stremio/manifest.json` |
| `GET` | `/addon/stremio/catalog/:type/:id.json` |
| `GET` | `/addon/stremio/configure` |
| `GET` | `/addon/stremio/:secret/manifest.json` |
| `GET` | `/addon/stremio/:secret/catalog/:type/:id.json` |
| `GET` | `/addon/stremio/:secret/configure` |
| `GET`/`POST` | `/addon/config` |

Catalog data also has plain-JSON equivalents used by the web UI: `/watchlist`,
`/continue`, `/recent`, `/stremio/list/:listId`, and
`/stremio/catalog/my_{watchlist_movies,watchlist_series,continue_series,recent_movies}`.

### Push notifications

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/push/public-key` | VAPID public key. |
| `POST` | `/push/subscribe` | `{ endpoint, keys: { p256dh, auth } }`. The endpoint must resolve to a real push service over https — including its DNS result — so a stolen API token can't turn the notification job into an SSRF proxy. |
| `POST` | `/push/unsubscribe` | `{ endpoint }`. |

### Notification channels

Non-push notification targets, scoped to the calling profile: `ntfy`, `gotify`,
`discord` and `webhook`. Unlike a push endpoint, these may point at a LAN or
loopback address — reaching a self-hosted ntfy is the point — so the URL is held
to the same rules as the AI provider endpoint instead: http(s) only, never the
cloud-metadata/link-local range, checked by DNS as well as by name, and
re-resolved immediately before each send. Redirects are refused, not followed.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/notifications/channels` | The profile's channels. The stored token is never returned — only `hasToken`. |
| `POST` | `/notifications/channels` | `{ kind, url, name?, token?, enabled? }`. An ntfy URL must include its topic; Gotify requires a token. Ten channels per profile. |
| `PATCH` | `/notifications/channels/:id` | `{ name?, url?, token?, enabled? }`. Omitting `token` keeps the stored one; `""` clears it. |
| `DELETE` | `/notifications/channels/:id` | |
| `POST` | `/notifications/channels/:id/test` | Sends a real test notification. Returns `{ success, error? }` — an upstream failure is a result, not a `500`, and the upstream body is never echoed back. |

A generic `webhook` receives `{ event, title, message, url, data }`; for an
upcoming episode, `data` carries `seriesImdbId`, `seriesName`, `season`,
`episode` and `episodeName`. Links (`url`, and the tap target on ntfy, Gotify
and Discord) are only included when `CATALOGGY_WEB_PUBLIC` tells the API where
the web UI lives.

### Export and import

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/export` | The profile's data as JSON: lists and their items, watch events, series progress, and ratings. Carries a `version` field. |
| `POST` | `/import` | Restores an `/export` payload. The body's `version` must be exactly `1`; anything else is a `400` rather than a partial restore. |
| `POST` | `/import/csv` | Header must include `imdbId,type,watchedAt`; `season,episode` optional. |
| `POST` | `/import/external` | `{ format, csv }` where format is `letterboxd-diary`, `letterboxd-ratings`, `imdb-ratings` or `simkl`. |

Letterboxd exports carry no IMDb ids, so each unique title costs a TMDB search.
Those two formats are capped at 10,000 rows; the id-carrying formats allow
200,000 per collection. Over the cap is a `413` with
`code: "too_many_rows"` — a row limit, not a byte limit, so raising
`MAX_BODY_SIZE_MB` does not affect it.

### Webhooks

No bearer token. Authenticated by `WEBHOOK_SECRET`, in a header where the
sender supports one and in a query parameter where it doesn't (Plex). Secrets
in query parameters are redacted from the logs.

| Method | Path |
| --- | --- |
| `POST` | `/webhooks/plex` |
| `POST` | `/webhooks/jellyfin` |

Set `WEBHOOK_ALLOWED_IPS` to also restrict them by source address. See the
[webhook secret placement](../README.md#webhook-secret-placement) section of the
README for which field each server can actually send.
