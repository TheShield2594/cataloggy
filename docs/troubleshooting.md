# Troubleshooting

Things that go wrong when self-hosting Cataloggy, and what they actually mean.
Most are configuration rather than bugs — if something here doesn't match what
you're seeing, [open an issue](https://github.com/TheShield2594/cataloggy/issues).

Two things to check before anything else:

```bash
docker compose ps          # is everything actually up?
docker compose logs api    # the API logs the reason it refused to start
pnpm smoke                 # end-to-end check of the health and catalog endpoints
```

- [Startup](#startup)
- [Nothing loads in the browser](#nothing-loads-in-the-browser)
- [Installing as an app, offline and push](#installing-as-an-app-offline-and-push)
- [Posters and metadata are missing](#posters-and-metadata-are-missing)
- [Watch history isn't appearing](#watch-history-isnt-appearing)
- [The Stremio add-on](#the-stremio-add-on)
- [Trakt](#trakt)
- [Import and export](#import-and-export)
- [Notifications](#notifications)
- [Games](#games)
- [AI recommendations](#ai-recommendations)
- [Database and migrations](#database-and-migrations)
- [Still stuck](#still-stuck)

## Startup

### "Refusing to start in production due to configuration problems"

The API checks four things before it will start in production, and names the
ones that failed:

| Message | Fix |
| --- | --- |
| `API_TOKEN is not set` | `openssl rand -hex 32` into `.env` |
| `API_TOKEN is set to the development default "dev-token"` | As above — `dev-token` is fine locally, never in production |
| `DATABASE_URL is not set` | Set it, or let compose build it from `POSTGRES_PASSWORD` |
| `DATABASE_URL uses the development default Postgres password` | Change `POSTGRES_PASSWORD` from `postgres` |

This is deliberate. All four leave the API reachable by anyone who can route to
it, and every one of them is easy to leave behind after a local trial run.

### "WEBHOOK_SECRET not set — webhook endpoints will reject all requests"

A warning, not a failure. Everything else works; only the Plex and Jellyfin
webhooks are disabled. Set `WEBHOOK_SECRET` if you use them.

### The `api` container restarts in a loop

It waits on `migrate` completing and Postgres being healthy. Check those first:

```bash
docker compose logs migrate
docker compose logs db
```

A failed migration is the usual cause — see
[Database and migrations](#database-and-migrations).

### Compose refuses to start at all

`API_TOKEN` and `POSTGRES_PASSWORD` are required and have no defaults. Compose
fails rather than silently starting an unauthenticated stack.

## Nothing loads in the browser

### Works on the server, not from your phone

The most common setup problem. `localhost` in the URLs means "this device", so a
phone loading the page tries to reach *itself*.

Every public URL in `.env` has to be the LAN IP (or domain) the client actually
uses:

```
CATALOGGY_API_PUBLIC=http://192.168.1.25:7000
CATALOGGY_WEB_PUBLIC=http://192.168.1.25:7002
ADDON_PUBLIC_BASE=http://192.168.1.25:7001
VITE_API_BASE=http://192.168.1.25:7000
VITE_ADDON_BASE=http://192.168.1.25:7001
CATALOGGY_ALLOWED_ORIGINS=http://192.168.1.25:7002
```

`VITE_*` are baked in at build time, so rebuild after changing them:

```bash
docker compose up -d --build web
```

The internal ones (`CATALOGGY_API_BASE`, pointing at `http://api:7000`) stay as
they are — that's service-to-service traffic inside the Docker network, and it
doesn't go via your LAN.

### Blocked by CORS

The browser's origin has to be in `CATALOGGY_ALLOWED_ORIGINS`. Scheme, host and
port all have to match — `http://192.168.1.25:7002` and
`http://cataloggy.local` are two different origins, so list both if you use
both.

### Blank page behind a reverse proxy

Add the hostname to `ALLOWED_HOSTS` on the `web` service. Without it, the web
server only answers to IPs and localhost.

If the API is reachable at a different address than `VITE_API_BASE` — a
per-browser override under Settings, say — add that origin to
`CSP_CONNECT_SRC_EXTRA` too, or the Content-Security-Policy blocks the request.

### 401 on every request

The browser's stored API token doesn't match `API_TOKEN`. Re-enter it in
Settings. A bearer-token failure carries a `WWW-Authenticate: Bearer` header,
which is how the client distinguishes it from other 401s such as a wrong
profile PIN.

### "Too many requests"

200 requests/minute per IP. Behind a reverse proxy without `TRUST_PROXY` set
correctly, every client looks like the proxy and shares one budget — that's the
usual cause of this appearing out of nowhere.

## Installing as an app, offline and push

Almost always one cause: **the page isn't a secure context**. Browsers only hand
out service workers, `Notification` and `PushManager` to `https://` origins and
to `localhost`/`127.0.0.1`. A LAN IP is neither, so on the
`http://192.168.x.x:7002` address the README quickstart hands out, the whole PWA
layer is switched off — not just notifications. Open the console: Cataloggy logs
a warning naming this when service-worker registration fails.

What that looks like:

- **No install prompt, and Cataloggy's own Install button never appears** —
  Chrome fires `beforeinstallprompt` only on an installable (secure) origin, and
  the button is bound to that event.
- **Nothing works offline, and posters aren't cached** — there is no service
  worker, so there is no cache. The offline banner says as much on these
  addresses rather than promising saved data.
- **Push reports as unsupported** — see the entry under
  [Notifications](#notifications).
- **iOS is the confusing exception** — Safari's **Add to Home Screen** honours
  `display: standalone` over plain http, so you get a full-screen icon with no
  offline and no push behind it. The install worked; the capabilities it implies
  never arrived.

The fix is an `https://` address: put Cataloggy behind a reverse proxy with a
certificate — see [Nginx Proxy Manager
Setup](../README.md#nginx-proxy-manager-setup) — and install from there. Testing
on the machine running Docker, `http://localhost:7002` is exempt and everything
works, which is why this only shows up once you open it on a phone.

If HTTPS isn't worth it for your setup, nothing else in Cataloggy is affected:
the LAN URL is fully functional, and **Settings → Notifications** channels
deliver episode alerts over plain http.

## Posters and metadata are missing

Cataloggy needs a TMDB API key for essentially all metadata. Without one, search
returns `500` with "TMDB integration is not configured".

Set it in **Settings → TMDB Metadata** (the setup wizard also asks). A key saved
there beats the `TMDB_API_KEY` environment variable, so a rotated key doesn't
mean editing `.env` and restarting. The key is validated against TMDB before it
saves, so a typo can't overwrite a working one.

- **Some titles have no poster** — TMDB has no image for them. Adding an RPDB
  key gives rating-badge posters instead.
- **Metadata is stale** — `POST /metadata/refresh-all` re-fetches in batches. It
  is rate-limit friendly by design and caps at 500 titles per call.
- **Posters don't load offline** — on an `https://` (or `localhost`) address the
  service worker caches them as they're first fetched, so a title you've never
  opened online won't be there. On a plain `http://LAN-IP` address none of them
  are cached at all — see [Installing as an app, offline and
  push](#installing-as-an-app-offline-and-push).

## Watch history isn't appearing

Cataloggy doesn't play anything, so history has to come from somewhere else.
Check which source you expect:

### Stremio play detection

Off by default. Set `STREMIO_PLAY_DETECTION=true` and install the add-on.

It works by inference: the add-on sees a stream or subtitle request and records
a *signal*, which becomes a watch once the title's runtime has elapsed. So:

- A watch appears roughly one runtime after you start, not immediately.
- Something you started and abandoned won't count. That's intentional.
- `GET /stremio/play-signals` shows what the add-on has seen but not yet acted
  on — the fastest way to tell "my client isn't reaching the add-on" apart from
  "it is, and the timer hasn't elapsed".

### Stremio library sync

Also off by default (`STREMIO_POLL_INTERVAL_SEC=0`). It reads Stremio's own
watched state rather than inferring it.

Connecting an account takes a *baseline* — it learns the current state without
recording it, so years of history don't land as a flood of backdated watch
events. `POST /stremio/library/import` is the opt-in backfill.

One known limitation: Stremio reports the episode you're *on*, so several
episodes finished within a single poll interval collapse into the latest one.
Two minutes is a reasonable interval; the default of `0` disables it entirely.

### Plex / Jellyfin webhooks

1. `WEBHOOK_SECRET` must be set (the API warns at startup if it isn't).
2. The webhook URL must be reachable from the media server — the LAN IP, not
   `localhost`.
3. Plex can't send custom headers, so its secret goes in a query parameter.
   Jellyfin can use a header. See
   [webhook secret placement](../README.md#webhook-secret-placement).
4. If you set `WEBHOOK_ALLOWED_IPS`, `TRUST_PROXY` has to be right or every
   request appears to come from the proxy.

Query-parameter secrets are redacted from the logs, so you won't see the token
echoed back when debugging — that's deliberate, not a truncated log line.

### A show won't leave Continue Watching

Drop it: `POST /show/:imdbId/drop`, or the control in the detail panel. This
hides it without deleting history, and `DELETE` on the same path undoes it.

## The Stremio add-on

- **Manifest won't install** — `ADDON_PUBLIC_BASE` has to be the address the
  *client* can reach, not the internal one. An Apple TV cannot resolve
  `http://addon:7001`.
- **Catalogs are empty** — they're per-profile. Check you installed the URL for
  the profile whose data you expect; each profile has its own secret path.
- **"Configure" goes nowhere** — that link is built from
  `CATALOGGY_WEB_PUBLIC`.
- **Add-on can't reach the API** — that one *is* internal:
  `CATALOGGY_API_BASE=http://api:7000`. Only change it if you renamed the
  service.

## Trakt

- **OAuth fails** — the redirect URI registered on trakt.tv has to match exactly
  what Cataloggy builds from `CATALOGGY_API_PUBLIC`. A trailing slash counts as
  a mismatch.
- **The callback 400s** — the `state` value expired or didn't match. Start the
  flow again; it's bound to the browser session that began it.
- **History isn't syncing** — `TRAKT_POLL_INTERVAL_SEC=0` disables the scheduled
  poll. `POST /trakt/poll` runs it once, on demand.
- **Removals don't propagate** — mirroring deletes to Trakt is opt-in:
  `TRAKT_WATCHLIST_MIRROR_DELETES=true`. Adds always mirror.
- **A sync failed and you didn't notice** — **Settings → Sync Status**
  surfaces failing scheduled jobs, which otherwise only appear in the logs.

## Import and export

- **413 with `code: "body_too_large"`** — the request body outgrew
  `MAX_BODY_SIZE_MB` (default 32, allowed range 1–1024). A large backup restore
  is the usual cause. Raise it and restart the API.
- **413 with `code: "too_many_rows"`** — a different limit, counted in rows
  rather than bytes, so raising `MAX_BODY_SIZE_MB` won't help. Letterboxd
  formats cap at 10,000 rows because each unique title costs a TMDB search; the
  id-carrying formats (`imdb-ratings`, `simkl`, native JSON) cap at 200,000 per
  collection. Split the file.
- **Letterboxd rows are skipped** — those exports carry no IMDb ids, so titles
  are resolved against TMDB by name and year. Ambiguous or obscure titles won't
  match. Rows that do match are still imported; the response summary counts both.
- **"Unrecognized IMDb ratings export header"** — the file has to be IMDb's own
  export, which has a `Const` column. A spreadsheet re-save can drop it.

## Notifications

- **Nothing arrives over push** — push needs VAPID keys and https (or
  localhost); browsers refuse service-worker push over plain http on a LAN IP.
  This is a browser rule, not something Cataloggy can work around, and it takes
  installing and offline down with it — see [Installing as an app, offline and
  push](#installing-as-an-app-offline-and-push) for the full picture. On a plain
  `http://192.168.x.x` deployment, add a notification channel instead
  (**Settings → Notifications**): ntfy, Gotify, a Discord webhook, or any URL
  that takes a JSON POST.
- **A channel is rejected on save** — its URL has to be http(s), and must not
  point at the cloud-metadata/link-local range, by name or by DNS result. A LAN
  or loopback address is fine: that check is about `169.254.169.254`, not about
  your own network. An ntfy URL also has to include the topic
  (`https://ntfy.sh/my-topic`, not `https://ntfy.sh`), and Gotify needs an
  application token.
- **A channel saves but nothing arrives** — use **Send a test notification** on
  the channel; it POSTs for real and reports the status it got back. `HTTP 401`
  or `403` is a token the other server didn't accept, `404` on ntfy is usually
  a topic typo, and a failure to connect at all usually means the address is
  reachable from your desk but not from inside the `api` container.
- **Notifications have no link to tap** — set `CATALOGGY_WEB_PUBLIC` to the
  externally reachable URL of the web UI. Without it the API doesn't know its
  own address, so it sends the notification without a link rather than a broken
  one.
- **A failing channel** is recorded like any other background job failure and
  shows up under **Settings → Sync Status**.
- **Subscribing returns 400** — the endpoint must be a real push service over
  https, and it's checked by DNS as well as by name. That check exists so a
  stolen API token can't point the notification job at an internal address.
- **Nothing on iOS** — the site has to be added to the home screen first. Safari
  doesn't deliver push to a tab.
- **Set `NOTIFICATION_CHECK_INTERVAL_SEC=0`** and the episode check is disabled
  entirely; the API logs this at startup.

## Games

The Games tab needs at least one integration to be useful, and they do different
jobs:

- **Adding a game** is an IGDB search — needs `TWITCH_CLIENT_ID` and
  `TWITCH_CLIENT_SECRET`.
- **Library and playtime sync** needs `STEAM_API_KEY` and `STEAM_ID`.

With neither, the tab has no way to populate itself. `502` from search means
IGDB is unreachable; `500` means the credentials are missing.

`STEAM_ID` is the 64-bit numeric id, not the vanity URL name. Your Steam profile
must also be public for the API to return anything.

If `STEAM_SYNC_INTERVAL_SEC` is out of range the API refuses to start and says
so — timer delays are a 32-bit value underneath, and a too-large one fires
immediately instead of waiting, hammering the sync in a loop. The same applies
to `TRAKT_POLL_INTERVAL_SEC`, `STREMIO_POLL_INTERVAL_SEC`,
`AI_REFRESH_INTERVAL_SEC` and `NOTIFICATION_CHECK_INTERVAL_SEC`: a value that
isn't a number (`5min`, say) is a startup error naming the variable, where it
used to disable that job silently while the log claimed it had been "set to 0".
Blank counts as unset, so the default applies; `0` is still the way to turn a
job off.

## AI recommendations

Optional. Without a provider configured, recommendations fall back to TMDB's
own similar-titles data.

- **Test fails with just "HTTP 500"** — that's on purpose. Echoing the provider's
  response body back would make the endpoint an SSRF probe, so only the status
  code is reported. Check the provider's own logs.
- **"url resolves to an address that is not an allowed outbound target"** — the
  hostname resolves somewhere blocked (cloud metadata, link-local). A LAN LLM on
  a normal private address is fine.
- **Recommendations are truncated or empty** — `max_tokens` was too low. Values
  under 2048 are clamped up automatically, since below that the model reliably
  truncates its JSON mid-response.
- **Results feel stale** — they're cached and refreshed daily.
  `POST /recommendations/ai/refresh` drops the cache.

## Database and migrations

### A migration failed

```bash
docker compose logs migrate
```

Restore from a backup and retry, rather than editing the schema by hand:

```bash
./scripts/restore.sh backups/cataloggy-<timestamp>.sql.gz
```

Take a backup before every update — `./scripts/backup.sh`. See
[Updating safely](../README.md#updating-safely--if-a-migration-fails).

### Images are on mismatched versions

Keep all four (`api`, `addon`, `web`, `migrate`) on one `CATALOGGY_IMAGE_TAG`.
The `migrate` image applies the schema the `api` image expects; mixing them is
how you get a running API against a schema it doesn't understand.

Unset, the tag means `latest`, which follows the most recent build of `main` —
`docker compose pull` can move you onto an untested build with nothing to fall
back to. Pin it:

```
CATALOGGY_IMAGE_TAG=v1.2.0
```

Rolling back is the same two commands with the previous tag.

### Resetting everything

Destroys all data:

```bash
docker compose down -v
docker compose up --build
```

## Still stuck

Useful things to gather first:

```bash
docker compose ps
docker compose logs --tail=100 api
curl -sS -H "Authorization: Bearer $API_TOKEN" http://localhost:7000/health
pnpm smoke
```

Also worth a look: **Settings → Sync Status**, which surfaces scheduled jobs
that are currently failing. If you've set `SENTRY_DSN`, unhandled errors are
there too — it's off by default, and no error data leaves your server without it.

When opening an issue, include the logs above, your Cataloggy version
(`CATALOGGY_IMAGE_TAG`), and a redacted `.env` — please strip `API_TOKEN`,
`POSTGRES_PASSWORD`, `WEBHOOK_SECRET`, and every API key before posting.
