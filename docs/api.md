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
  - [Health](#health)
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

Five paths are exempt, because they cannot carry a bearer token by construction:

| Path | Why it is exempt | What guards it instead |
| --- | --- | --- |
| `GET /health` | Container health probe | Nothing — it reports no data |
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
  Cataloggy's own rows (lists, games, profiles, watch events).
- **Caching**: `GET` responses carry an ETag. Send `If-None-Match` and you get a
  `304` with no body. Responses over 1 KB are compressed (`br`, `gzip`,
  `deflate`).
- **Body size** is capped by `MAX_BODY_SIZE_MB` (default 10). Restoring a large
  backup is the case that hits it; the `413` says so.

## Endpoints

### Health

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ status, service }`. No auth, no database. |

### Search and metadata

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/search?q=&type=` | `type` is `movie`, `series` or `all` (default). `query` works as an alias for `q`. Max 20 results, each flagged with `inWatchlist` / `inCollection` / `lists`. |
| `GET` | `/meta/:type/:imdbId` | Full metadata for one title. |
| `GET` | `/meta/:type/:imdbId/bundle` | Everything the detail panel needs — meta, cast, providers, recommendations, seasons, dropped state — in one round trip. Optional sections degrade to empty rather than failing the response. |
| `GET` | `/meta/:type/:imdbId/cast` | Cast and director. |
| `GET` | `/meta/:type/:imdbId/providers` | Where to stream it, for the configured region. |
| `GET` | `/meta/series/:imdbId/seasons` | Season list. |
| `GET` | `/meta/series/:imdbId/season/:n/episodes` | Episodes for one season. Fetched on demand as a season is expanded. |
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
| `POST` | `/watch` | Record a watch. `{ type: "movie" \| "episode", imdbId, seriesImdbId?, season?, episode?, watchedAt? }`. |
| `GET` | `/watch/history?limit=&offset=&imdbId=` | `limit` is 1–200, default 50. Filtering happens server-side so it searches every row, not just the loaded page. |
| `PATCH` | `/watch/:eventId` | Change a watch date. |
| `DELETE` | `/watch/:eventId` | |
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
| `POST` | `/series/:imdbId/season/:s/episode/:e/watch` | |
| `DELETE` | `/series/:imdbId/season/:s/episode/:e/watch` | |
| `POST` | `/series/:imdbId/season/:s/watch-all` | |
| `GET` | `/show/:imdbId/dropped` | |
| `POST` | `/show/:imdbId/drop` | Hide a show from Continue Watching without deleting its history. |
| `DELETE` | `/show/:imdbId/drop` | Un-drop. |

### Check-in and scrobbling

Check-ins are manual ("I'm watching this now"); scrobble sessions are what the
Plex and Jellyfin webhooks drive.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/checkin` | The current check-in, if any. |
| `POST` | `/checkin` | `{ type, imdbId, name, seriesImdbId?, season?, episode?, runtime? }`. With `runtime`, it expires on its own. |
| `DELETE` | `/checkin` | |
| `GET` | `/scrobble/now-playing` | |
| `POST` | `/scrobble/start` \| `/scrobble/pause` \| `/scrobble/stop` | Stale sessions are swept periodically. |

### Ratings

Five stars, stored as 1–10 so half-stars survive a round trip.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/ratings?type=&limit=&imdbId=` | |
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
| `POST` | `/lists` | `{ name, kind }`. |
| `PATCH` | `/lists/:id` | `{ name }`. |
| `DELETE` | `/lists/:id` | |
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
| `DELETE` | `/tags/:tagId` | |
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
| `POST` | `/profiles` | `{ name, avatar?, pin? }`. |
| `PATCH` | `/profiles/:id` | |
| `DELETE` | `/profiles/:id` | |
| `POST` | `/profiles/:id/verify` | `{ pin }` → a profile token for `x-profile-token`. Rate limited. |

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
| `GET`/`POST`/`DELETE` | `/omdb/status`, `/omdb/key` | Validated against OMDb; its error text is passed through. |
| `GET`/`POST`/`DELETE` | `/rpdb/status`, `/rpdb/key` | Not validated on save. |
| `GET` | `/rpdb/poster/:imdbId` | `404` when no key is set. |
| `GET` | `/rpdb/config` | Used by the add-on service, which needs the key to build poster URLs itself. |

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
| `POST` | `/trakt/import` | One-time history import. |
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
| `POST` | `/stremio/play-signal` | Written by the add-on service. The profile id in the body is validated, not trusted. |
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

### Export and import

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/export` | The profile's data as JSON: lists and their items, watch events, series progress, and ratings. |
| `POST` | `/import` | Restores an `/export` payload. |
| `POST` | `/import/csv` | Header must include `imdbId,type,watchedAt`; `season,episode` optional. |
| `POST` | `/import/external` | `{ format, csv }` where format is `letterboxd-diary`, `letterboxd-ratings`, `imdb-ratings` or `simkl`. |

Letterboxd exports carry no IMDb ids, so each unique title costs a TMDB search.
Those two formats are capped at 10,000 rows; the id-carrying formats get the
higher `MAX_IMPORT_ROWS` ceiling. Over the cap is a `413` with
`code: "too_many_rows"`.

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
