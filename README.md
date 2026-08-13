# Cataloggy

Cataloggy is your own personal Netflix-style home page for everything you watch. It pulls together what's on your watchlist, what you're currently binging, and what's trending, and gives you one clean dashboard instead of jumping between five different apps.

Self-host it on your home server, open it on your phone or computer, and keep track of your shows and movies the way you actually want to. On the TV, a Stremio add-on puts your catalogs in front of the remote.

## Why you might like it

- **One home screen for everything** — continue watching, recently watched, and upcoming episodes, all in one place
- **Works with the tools you already use** — pairs with Stremio, Plex, Jellyfin, Trakt, and Stremio/Omni add-ons
- **No account you can't walk away from** — watch history comes straight from Stremio, Plex or Jellyfin, and every third-party service is optional and replaceable
- **Yours, not the cloud's** — runs on your own hardware, your data stays on your network
- **Phone friendly** — installs as an app on your phone (PWA)
- **Works with your TV** — a Stremio add-on puts your catalogs on Apple TV (via Omni) and Android TV

## Getting Started

The fastest way to try Cataloggy is with Docker Compose — see [Docker Compose install](#docker-compose-install-recommended) below. If you'd rather poke around the code first, jump to [Local development without Docker](#local-development-without-docker).

---

## For the technically curious

The rest of this README covers setup, configuration, and the moving parts under the hood. Two companion docs go deeper:

- **[Troubleshooting](docs/troubleshooting.md)** — what the startup errors mean, why the page loads on the server but not your phone, and why watch history isn't showing up.
- **[API reference](docs/api.md)** — every endpoint, for scripting against Cataloggy or building your own client.

Cataloggy is a Node.js monorepo set up with `pnpm` workspaces.

### Structure

```text
cataloggy/
  apps/
    api/        # Fastify API + Prisma
    addon/      # Stremio/Omni addon service
    web/        # React + Vite PWA frontend
  packages/
    shared/     # shared types/utilities
  docker-compose.yml
  README.md
```

### Requirements

- Node.js 22.12+ (the Docker images and CI run Node 26)
- pnpm 11+ (`corepack enable` picks up the pinned version automatically)
- Docker + Docker Compose

## Docker Compose install (recommended)

1. Copy `.env.example` to `.env` next to `docker-compose.yml` and fill in real values:

   ```bash
   cp .env.example .env
   ```

   - **Required:** `API_TOKEN` and `POSTGRES_PASSWORD` — `docker compose up` will refuse to start without them (used by both `api` and `addon` services — they share the same `API_TOKEN`). Generate a token with `openssl rand -hex 32`.
   - **Recommended for LAN devices** (phone/Apple TV): update the URLs in `api`, `addon`, and `web` services to use your LAN IP instead of `localhost`
   - **Optional integrations:** `TMDB_API_KEY`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` (in `api` service). `TMDB_API_KEY` can also be set from the app — the setup wizard asks for it, and **Settings → TMDB Metadata** changes it later — so a mistyped or rotated key doesn't mean editing this file and restarting. A key saved there takes precedence over this variable.
   - **Optional (Games section):** `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (IGDB game search/metadata), `STEAM_API_KEY`, `STEAM_ID` (Steam library import) — in `api` service. Leaving these unset is safe, but the Games tab needs at least one pair configured to be useful: adding a game is done by searching IGDB, so it requires `TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`; automatic library/playtime sync requires `STEAM_API_KEY`/`STEAM_ID`. With neither set, the Games tab has no way to populate itself.
   - **Optional:** `SENTRY_DSN` — reports unhandled errors from the `api`, `addon`, and `web` services to a Sentry project (or compatible service). Leave unset to disable; no error data leaves your server by default.
   - **Optional:** `ALLOWED_HOSTS` (in `web` service) — comma-separated hostnames allowed to reach the web server beyond IPs/localhost, e.g. a domain proxied via Nginx Proxy Manager (see below). Leave unset for LAN-IP-only access.
   - **Optional:** `CSP_CONNECT_SRC_EXTRA` (in `web` service) — comma-separated extra origins the browser may connect to, on top of `VITE_API_BASE`, `VITE_ADDON_BASE` and `SENTRY_DSN`, which the web server's `Content-Security-Policy` already allows. Only needed if some browsers reach the API at a different address than `VITE_API_BASE` — e.g. one set per-browser under Settings → "API base URL", or a domain used alongside the LAN IP.

   **Internal vs. public URLs:** the `api` and `addon` services distinguish between the URL used for service-to-service traffic inside the Docker network and the URL your browser/Apple TV/Omni actually reach:

   - `CATALOGGY_API_BASE` (addon service) — internal URL the addon uses to call the API (e.g. `http://api:7000`). Only needs to change if you rename the `api` service or run it elsewhere.
   - `CATALOGGY_API_PUBLIC` (api service) — externally reachable URL for the API, used to build the Trakt OAuth redirect URI. Set this to the LAN IP or domain you actually use to reach the API.
   - `ADDON_PUBLIC_BASE` (addon service) — externally reachable URL for the addon, used when generating manifest/catalog URLs for clients like Apple TV.
   - `CATALOGGY_WEB_PUBLIC` (api and addon services) — externally reachable URL for the web UI, used to build the "Configure" link Stremio shows on the addon's manifest (it redirects to the Settings page), and the link a notification channel gives you to tap.
   - `VITE_ADDON_BASE` (web service) — externally reachable URL for the addon, used to build the manifest URL shown on the Settings page. Should match `ADDON_PUBLIC_BASE`.

2. Start everything:

   ```bash
   docker compose up --build
   ```

   **Pinning the version you run.** All four app images (`api`, `addon`, `web`, `migrate`) take their tag from `CATALOGGY_IMAGE_TAG` in your `.env`. Unset, it means `latest`, which always follows the most recent build from `main`: `docker compose pull` can move you onto an untested build, and there's no earlier version to fall back to. Once the stack works, pin it — every build is also published as `sha-<short-sha>`, and tagged releases as `vX.Y.Z`:

   ```bash
   # in .env, next to docker-compose.yml
   CATALOGGY_IMAGE_TAG=v1.2.0
   ```

   ```bash
   docker compose pull && docker compose up -d
   ```

   Rolling back is the same two commands with the previous tag. Keep all four images on one tag — the `migrate` image applies the schema the `api` image expects — which is why it's a single setting. The Postgres image and the Node base image the app images are built from are pinned by digest in the repo, so a rebuild uses the exact image the stack was tested against; Dependabot proposes those bumps weekly.

3. Run the smoke checks:

   ```bash
   pnpm smoke
   ```

   This validates API and add-on health endpoints, (when all Trakt env vars are configured) runs `/trakt/import` and verifies a catalog response contains a `metas` array, and (when `STEAM_API_KEY`/`STEAM_ID` are configured) runs `/games/steam/sync` and verifies it returns a sync summary.

## Local development without Docker

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Start local dev services:

   ```bash
   pnpm dev
   ```

## Services

- API: http://localhost:7000/health
- Addon: http://localhost:7001/manifest.json
- Web: http://localhost:7002
- Postgres: `localhost:5432` (user `postgres` by default, db `cataloggy`, password from `POSTGRES_PASSWORD` in your `.env`)


## Use on Your Local Network (Phone + Apple TV)

### Find your LAN IP (brief)

Your LAN IP is your computer's local network address (usually like `192.168.x.x` or `10.0.x.x`).

- **macOS:** System Settings → Network → select active connection → look for **IP Address**
- **Windows:** Command Prompt → `ipconfig` → look for **IPv4 Address**
- **Linux:** Terminal → `hostname -I`

### Open Cataloggy on your phone

On your phone (connected to the same Wi-Fi), open:

```text
http://LAN-IP:7002
```

Example:

```text
http://192.168.1.25:7002
```

### Install as a PWA

- **iOS Safari:** **Share** → **Add to Home Screen**
- **Android Chrome:** **⋮ menu** → **Add to Home screen** (Chrome may also show an automatic "Install app" banner)

### Install Omni add-on on Apple TV

Use this add-on URL in Omni:

```text
http://LAN-IP:7001/manifest.json
```

> **Important:** Apple TV cannot use `localhost` URLs. The add-on URL must be reachable on your LAN from Apple TV.

### Install the add-on on Android / Android TV

Cataloggy's add-on service speaks the standard Stremio add-on protocol, so it works with the [Stremio app](https://www.stremio.com/downloads) on both Android phones/tablets and Android TV:

1. Install **Stremio** from the Play Store (or sideload the APK on Android TV devices without Play Store access).
2. Open Stremio → **Add-ons** → search icon / **"Community Add-ons"** → paste the add-on URL:

   ```text
   http://LAN-IP:7001/manifest.json
   ```

3. Confirm installation. Cataloggy's catalogs and metadata now appear inside Stremio's **Board**/**Discover** views.

> **Important:** Android TV cannot use `localhost` URLs either — use your LAN IP (or your public domain, if set up via the Nginx Proxy Manager section below) so the URL is reachable from the TV.

The Stremio app is the way to use Cataloggy on a TV. The web app is built for touch and pointer input: it has no D-pad/arrow-key focus navigation and no 10-foot layout, so while it will load in an Android TV browser, driving it with a remote is painful. Apple TV has no web browser at all, so Omni plus the add-on is the only route there.

### Profiles and the add-on URL

Stremio and Omni have no way to say *who* is watching — the installed URL is the only thing that distinguishes one installation from another. Cataloggy therefore binds a profile to the URL itself:

```text
http://LAN-IP:7001/p/PROFILE-ID/manifest.json
```

Behind a reverse proxy (see the Nginx section below), the `/p/PROFILE-ID` part sits after the proxy path, not before it:

```text
https://cataloggy.domain.com/addon/p/PROFILE-ID/manifest.json
```

Rather than assembling either by hand, use **Settings → Stremio Addon** — it always shows the correct, ready-to-paste URL for the profile you're currently using. To install for someone else: switch to their profile, come back, and copy the URL again. Catalogs, "Mark Watched", and scrobbles from that installation all belong to that profile.

The prefix-less URLs (`http://LAN-IP:7001/manifest.json`, `https://cataloggy.domain.com/addon/manifest.json`) keep working and resolve to your oldest profile, so installs made before profiles existed are unaffected — but on a household with several profiles, each person should install their own URL.

### Profiles and the Plex/Jellyfin webhooks

Plex and Jellyfin don't send Cataloggy's profile header either, so a scrobble's profile is worked out from the webhook itself:

1. **A profile pinned to the URL.** Add `profile=<profile-id>` to the webhook URL you configure in Plex/Jellyfin, alongside the secret:

   ```text
   http://LAN-IP:7000/webhooks/plex?token=WEBHOOK_SECRET&profile=PROFILE-ID
   ```

   Both servers let you set the target URL per user, so this is the reliable option for a shared server. An unknown or malformed profile ID is rejected rather than quietly redirected.

   On Jellyfin, send the secret as an `x-webhook-secret` header instead and leave only `profile` in the URL — see [Webhook secret placement](#webhook-secret-placement) below.
2. **The media-server account name.** With no `profile` parameter, the Plex account title (or the Jellyfin username) is matched against your profile names, ignoring case — so a Plex user named `Sam` scrobbles into the Cataloggy profile named `Sam` with nothing to configure.
3. **Your oldest profile**, if neither applies. This is what single-profile installs get, and what every webhook did before profiles were taken into account.

## Where watch history comes from

Cataloggy records what you've watched from whichever of these you set up — none is required, and they can run side by side:

| Source | How it reaches Cataloggy |
| --- | --- |
| **Any Stremio-add-on app** | Play detection — see below |
| **Stremio** | Reads your Stremio account library directly — see below |
| **Plex** | Webhook, as it happens |
| **Jellyfin** | Webhook, as it happens |
| **The web app** | Marking watched by hand, check-ins, the scrobble API |
| **Stremio add-on** | The "Cataloggy: Mark Watched" entry in the subtitle menu |
| **Trakt** | Optional — see [Trakt is optional](#trakt-is-optional) |
| **Other trackers** | One-off CSV/JSON imports (Letterboxd, IMDb, Simkl) — see [Export / import your data](#export--import-your-data) |

### Play detection (any app that supports Stremio add-ons)

Stremio add-ons are strictly read-only: a client *asks* an add-on for catalogs, metadata, streams and subtitles, and is never able to report back what was watched. There is no callback and no webhook in the protocol. That's why marking watched from an add-on app has always meant picking the fake "Cataloggy: Mark Watched" subtitle by hand.

But the asking itself leaks intent. Two requests mean "the user is about to watch this":

- **`stream`** — they opened a title's stream list
- **`subtitles`** — a player actually loaded

Cataloggy's add-on now declares the `stream` resource purely to receive that request (it always answers with an empty list, so nothing extra shows up in your client) and forwards both signals to the API. This is the only automatic mechanism available for apps that keep their library entirely to themselves — **Vidi, Omni, Nuvio** and other add-on-consuming clients that never sync to a Stremio account.

Because it infers completion rather than observing it, it's **off by default**. Set `STREMIO_PLAY_DETECTION=true` on **both** the `api` and `addon` services — the add-on observes, the API decides.

How a signal becomes a watch:

1. A signal opens a **pending play**, due once 80% of the title's runtime has passed (the same threshold a real scrobble uses).
2. It's promoted to a watch when that time elapses, **or** immediately when the next episode of the same series starts — moving on is the strongest completion evidence the protocol can offer.
3. It's discarded if a different title is opened within two minutes. That's browsing, not watching.

Nothing pending is user-visible history; only what survives becomes a watch event. **Settings → Play Detection** lists what's pending, which resource produced each signal, and which client sent it — so you can confirm your apps actually signal, and see what's about to be counted, before trusting it.

### Stremio watched sync

Stremio's add-on protocol is read-only: an add-on serves catalogs and metadata, and is never told what you watched. But every Stremio client signed in to a **Stremio account** syncs its library — including watched state — to Stremio's servers, and Cataloggy can read that directly.

Connect the account under **Settings → Stremio Watched Sync**. One connection covers every client on that account: desktop, mobile, Android TV, the web app, and third-party clients that sign in with a Stremio account. There's nothing to install per device.

- Your password is exchanged for an access key once and **never stored** — only the key is.
- Connecting starts tracking from that moment. Use **Import watch history** once to pull in what the account already has marked as watched, dated from Stremio's own watch history rather than from today. Play detection can't do this — it only ever sees things going forward — so this import is the way to bring existing history across without routing through Trakt.
- The scheduled poll is **off by default** (`STREMIO_POLL_INTERVAL_SEC=0`). Nothing syncs on its own until you enable it — set it to `120`, or enable play detection above, or use **Sync now** in Settings by hand. Turn the poll on if you'd rather have Stremio's own exact watched state than an inference; a check costs a single small request when nothing has been watched.
- Only IMDb-keyed content is matched. Items from add-ons using their own ID schemes, and live-TV entries, are skipped rather than guessed at.
- Stremio reports the episode you're *on*, not a full play log, so episodes finished within a single poll interval collapse into the most recent one. At a 120-second interval that needs you to clear an episode in under two minutes.
- Guest mode has no synced library, so there's nothing to read — the account is what makes this work.

### Trakt is optional

Trakt is supported but is not a system of record, and nothing depends on it:

- **Metadata** comes from TMDB, never Trakt.
- **Importing** from Trakt is a one-time action (**Settings → Trakt Integration → Run Full Import**) and keeps working whether or not you leave the ongoing poll on. One run pulls everything Cataloggy can hold from a Trakt account, so it's enough to stop depending on Trakt afterwards:
  - **Watch history** — every play, however far back, each dated as Trakt recorded it, so History and per-year stats go back as far as your account does.
  - **Ratings** — movies, shows, seasons and individual episodes, all of them. Cataloggy shows your ratings as five stars in half-star steps and stores them out of ten, which is the same ten values: an imported 9 stays a 9 rather than collapsing into a 10. Season and episode ratings live on the seasons list in a show's detail panel, alongside the show's own rating.
  - **Watchlist**, **collection** (into the Collection list) and **personal lists** (each becoming a custom list of the same name — a list already here under that name is filled rather than duplicated, so re-running is safe).

  Anything Trakt knows only by its own or TMDB's id is skipped and counted, never guessed at. On a large library the import can take several minutes; afterwards the scheduled poll only fetches what is new. `TRAKT_BACKFILL_MAX_PAGES` caps how far back a single import walks: 100 plays per page, default `500` pages (50,000 plays), hard ceiling `1000` pages (100,000 plays) — a larger value is clamped to that, and a value that isn't a positive whole number falls back to the default.
- **Ongoing polling** (`TRAKT_POLL_INTERVAL_SEC`) is off-switchable: set it to `0`. With Stremio watched sync connected, the poll is no longer the only thing catching what you watch in Stremio.
- **Removals on Trakt never remove anything locally** unless you opt in with `TRAKT_WATCHLIST_MIRROR_DELETES=true`. Even then, a Trakt watchlist that has gone entirely empty is treated as a fault and never mirrored — so a broken or discontinued Trakt cannot empty your library.
- **Scrobbles and watchlist changes still push out to Trakt** when it's connected. That direction is a mirror: if Trakt stops answering, the pushes fail quietly and nothing local is affected.

Everything Cataloggy knows can be exported as a single JSON file (lists, watch history, series progress, ratings) — see [Export / import your data](#export--import-your-data).

## Notifications

Cataloggy can tell you when the next episode of something you're watching airs.
Two ways to receive that, set up under **Settings → Notifications**:

- **Browser push** — needs no other software, but has prerequisites a LAN
  install often can't meet: browsers refuse service-worker push over plain
  http, so `http://192.168.1.25:7002` won't do, and on iOS the site has to be
  added to the home screen first.
- **A notification channel** — one HTTP POST to something you already run, so
  none of the above applies:
  - **ntfy** — paste the full topic URL (`https://ntfy.sh/my-topic`, or your own
    server). A token is only needed for a protected topic.
  - **Gotify** — your server's URL plus an application token.
  - **Discord** — a channel webhook URL.
  - **Webhook** — any URL, which receives a JSON POST (`event`, `title`,
    `message`, `url`, and the episode's details) — enough for Home Assistant,
    Slack, n8n or a script of your own.

Channels belong to a profile, so a household can point each one somewhere
different, and a profile can have several. **Send a test notification** on a
saved channel POSTs for real and reports what came back, rather than leaving you
to find out at the next episode. Set `CATALOGGY_WEB_PUBLIC` if you want the
notifications to link back into the app.

A channel URL is checked the same way the AI provider endpoint is: http(s)
only, never the cloud-metadata/link-local range, by DNS result as well as by
name, and re-checked immediately before each send. LAN and loopback addresses
are allowed, since that is the point. A channel that starts failing shows up
under **Settings → Sync Status**.

## Nginx Proxy Manager Setup

Configure Nginx Proxy Manager with one Proxy Host for your domain (for example, `cataloggy.domain.com`):

- **Proxy Host target:** web service on port `7002`
- **Advanced locations:**
  - `/api/` → port `7000`
  - `/addon/` → port `7001`

Set `ALLOWED_HOSTS=cataloggy.domain.com` in your `.env` so the web service accepts requests for that hostname, then restart the `web` service.

Also set `TRUST_PROXY` to the address the `api` container sees Nginx Proxy Manager connect from — its address on the Docker network, not its LAN address. `TRUST_PROXY=172.16.0.0/12` covers the default Docker bridge range and is the usual working answer. Without it the api and addon ignore the `X-Forwarded-For` header the proxy sends, so every request looks like it came from the proxy itself: one shared 200/min rate-limit budget for the whole household (the usual cause of "Too many requests" appearing out of nowhere), and `WEBHOOK_ALLOWED_IPS` can never match.

Name the proxy rather than setting `TRUST_PROXY=true`. `true` trusts the whole forwarded chain, and Nginx's `$proxy_add_x_forwarded_for` *appends* to the `X-Forwarded-For` a client sent rather than replacing it — so a client that sends its own header picks its own `request.ip`, which is enough to sidestep the rate limit and to satisfy `WEBHOOK_ALLOWED_IPS` with a Plex server's address it doesn't have. Naming the proxy bounds the trust to the hop you control, which is also why the variable is unset by default.

The `/api/` and `/addon/` prefixes above are stripped by the services themselves, which expect exactly those two by default. If your proxy mounts them somewhere else, set `API_PROXY_PATH_PREFIXES` / `ADDON_PROXY_PATH_PREFIXES` to match — they are separate variables because the two services need different values, and because giving the api `/addon` would strip the prefix off its own built-in Stremio manifest routes.

Use this Omni add-on URL to install when accessing through your domain:

```text
https://cataloggy.domain.com/addon/p/PROFILE-ID/manifest.json
```

Copy it from **Settings → Stremio Addon** rather than filling in `PROFILE-ID` yourself — see [Profiles and the add-on URL](#profiles-and-the-add-on-url) for why the profile is part of the URL. Dropping the `/p/PROFILE-ID` segment also works and resolves to your oldest profile.

LAN development URLs stay available, so you can continue using direct local access like `http://LAN-IP:7002` and `http://LAN-IP:7001/p/PROFILE-ID/manifest.json` on your network.

## Backup & Restore

Cataloggy stores everything in the Postgres database run by the `db` service in `docker-compose.yml`. Two helper scripts wrap `pg_dump`/`psql` for simple backup and restore:

```bash
# Back up the database to backups/cataloggy-<timestamp>.sql.gz
./scripts/backup.sh

# Restore from a backup file (prompts for confirmation; overwrites current data)
./scripts/restore.sh backups/cataloggy-20260101-120000.sql.gz
```

Both scripts run against the `db` service via `docker compose exec`, so Docker Compose must already be up. They read `POSTGRES_USER`/`POSTGRES_DB` from the environment (same defaults as `docker-compose.yml`: `postgres`/`cataloggy`), and `backup.sh` writes into `BACKUP_DIR` (defaults to `./backups`).

To schedule automatic backups, add a cron entry that runs `backup.sh` on a schedule, e.g. nightly at 3am:

```cron
0 3 * * * cd /path/to/cataloggy && ./scripts/backup.sh >> backups/backup.log 2>&1
```

A dump is a complete copy of your database — every profile's watch history and lists, plus the OAuth access/refresh tokens stored for Trakt, Twitch and Steam and the access key for a connected Stremio account. Treat the file like a password:

- `backup.sh` runs under `umask 077` and `chmod`s `$BACKUP_DIR` to `700` and each dump to `600`, so other local users on the host can't read them. Point `BACKUP_DIR` at a directory that only you own.
- `backups/` and `*.sql.gz` are git-ignored, so a `git add -A` from the repo root can't sweep a dump into git history. If you move backups elsewhere within the repo, keep them ignored.
- Backups you copy off the host (to a NAS, cloud storage, another machine) leave that protection behind — encrypt them, or store them somewhere with equivalent access control.

### Export / import your data

In addition to full database backups, Settings → Data lets you export your lists, watch history, series progress, and ratings as a single JSON file, and re-import it later (e.g. after a fresh install, or to migrate to a new instance). The API also accepts CSV watch-history imports (columns: `imdbId`, `type`, `watchedAt`, with optional `season`/`episode`) for importing history exported from other tools.

Settings → Data also supports importing directly from other trackers' CSV exports via `POST /import/external` (`format`: `letterboxd-diary`, `letterboxd-ratings`, `imdb-ratings`, or `simkl`). Letterboxd exports don't include IMDb IDs, so titles are resolved against TMDB on a best-effort basis; unmatched rows are skipped and reported in the import summary.

Imports are sent as a single request body, capped at `MAX_BODY_SIZE_MB` (32 MB by default — roughly 200k watch events). A larger file is rejected with a 413 that names the limit; raise the variable and restart the API to accept it.

### Updating safely / if a migration fails

The `migrate` container runs `prisma migrate deploy` and exits, applying any new database migrations that shipped since your last update. The `api` container waits for it to finish before starting, so every update applies its migrations before anything serves traffic. This is usually seamless, but two things are worth knowing before you run `docker compose pull && docker compose up -d` on a long-unattended instance:

- **Back up first.** Run `./scripts/backup.sh` before pulling a new image. Prisma migrations aren't automatically reversible, so a backup taken right before updating is your fastest way back to a known-good state if something goes wrong.
- **If `prisma migrate deploy` fails**, the `migrate` container exits non-zero and `docker compose ps` will show `api` as never having started rather than serving traffic — check `docker compose logs migrate` for the failing migration. To recover:
  1. Restore the database from the backup you took before updating (`./scripts/restore.sh <backup-file>`) — rolling back the image alone won't undo a partially-applied migration.
  2. Roll back to the previous working image tag (see "Docker Compose install" above for pinning by `sha-<short-sha>` or a semver tag) and start it against the restored database. The `migrate` image is tagged in lockstep with `api`, so roll both back together.

If you don't have a recent backup when this happens, don't guess at manually editing the `_prisma_migrations` table — that's how partial-migration failures turn into data loss. Open an issue with the failing migration name and the error from `docker compose logs migrate` instead.

## Security

Cataloggy is designed for self-hosting on a trusted local network (LAN), not for direct exposure to the internet. Known limitations:

- The web client stores its API bearer token in `localStorage`. Any JavaScript running on the page (e.g. via an XSS vulnerability in a dependency) could read this token. Since the token only grants access to your own local API, this is an acceptable tradeoff for a LAN-only app. If exposing it via a reverse proxy, both the API and web client now send a restrictive `Content-Security-Policy` (no framing, and no inline script beyond the one the page itself ships, which is allowed by the SHA-256 hash of its exact contents rather than by `'unsafe-inline'`) plus `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` headers to reduce the impact of a dependency-introduced XSS bug, but migrating to httpOnly session cookies would be a stronger fix if you need this on the internet.
- That CSP's `connect-src` names only the origins this deployment actually talks to — `'self'`, plus `VITE_API_BASE`, `VITE_ADDON_BASE`, (if set) the `SENTRY_DSN` host, and the artwork CDNs the service worker caches posters from — rather than allowing every host, so script injected into the page cannot post your token to an arbitrary server. The header is rendered from `apps/web/serve.template.json` when the `web` container starts, since those origins are only known then. If some browser needs to reach an origin the container doesn't know about (most likely a per-browser API base set in Settings), add it to `CSP_CONNECT_SRC_EXTRA` — otherwise the browser will block the request. `style-src` still allows `'unsafe-inline'`, which the app's inline React styles require; style injection is far lower-risk than script injection, so that one is an accepted weakening.
- The Stremio add-on protocol sends no credentials, so the API's built-in catalog manifest (`/addon/stremio/...`) cannot sit behind `API_TOKEN`. It is instead gated by an unguessable per-profile secret in the URL path (`/addon/stremio/<secret>/manifest.json`), derived from `API_TOKEN` and served to that profile from `GET /addon/config`; requests without a valid secret get the token check like any other route, and the secret decides which profile's lists are served, so one add-on URL cannot read another profile's library. Rotating `API_TOKEN` invalidates every add-on URL — reinstall from Settings afterwards.
- The separate add-on service (port `7001`, the full-featured one Settings links to) is still unauthenticated: anyone who can reach it can read the lists of the profile named in its URL (or the oldest profile, for the prefix-less URL). That is inherent to the protocol — Stremio cannot send a token — so keep that port on your LAN, and do not proxy it to the internet unless you are comfortable with your watchlist being public. Its write endpoints are separately protected. The scrobble endpoint takes a bearer token derived from `API_TOKEN`, which the service never emits. "Mark Watched" cannot use that token — Stremio can only fetch a plain URL, so the credential has to be in the URL, and the subtitles response carrying it is served to anyone who asks — so each of those URLs carries a capability signed for the one profile and the one title or episode it was built for, expiring after twelve hours. Reading one out of a subtitles response (or a proxy log) therefore allows re-marking that single title, not writing arbitrary history.
- Connecting a Stremio account stores only the access key Stremio issues, never your password — the password is sent once to Stremio's login endpoint, exchanged for the key, and discarded. The key is not scoped: it grants the same library access a signed-in Stremio client has, so it belongs to the same "treat your database dump like a password" bracket as the Trakt and Steam tokens. Disconnecting from Settings deletes it. `POST /stremio/library/connect` is rate-limited to 10/min/IP like the other credential-accepting routes.
- Linking a Trakt account is CSRF-protected: `GET /trakt/oauth/authorize` (which requires the API token) mints a single-use `state` that expires in 10 minutes, and the callback rejects anything else — so a link someone else sends you cannot silently bind your install to their Trakt account.
- If you do expose Cataloggy beyond your LAN, put it behind a reverse proxy with TLS (e.g. Nginx Proxy Manager) and consider implementing a proper session-based auth flow.
- All API routes are rate-limited globally (200 req/min/IP), with tighter per-route limits on sensitive endpoints: PIN verification (`POST /profiles/:id/verify`, 10/min/IP), the Trakt OAuth authorize/callback routes (10/min/IP), the Plex/Jellyfin webhooks (60/min/IP) and the built-in Stremio manifest/catalog routes (240/min/IP — they answer unauthenticated callers, but a Stremio home screen fetches one request per catalog, so the budget covers several refreshes a minute rather than a single request). Calls from the Stremio addon service get their own 1000 req/min bucket rather than sharing the browser's — every Stremio client reaches the API from that one container's IP. The addon identifies itself with a token derived from `API_TOKEN` (never the raw token, which the browser also holds), so nothing extra needs configuring and a leaked browser token cannot drain the addon's budget. The limiter's counters are in-memory and per-process, so they assume the documented single-`api`-container deployment; running multiple API replicas would give each its own independent budget.
- The Plex/Jellyfin webhook endpoints (`/webhooks/plex`, `/webhooks/jellyfin`) authenticate with a single shared secret (`WEBHOOK_SECRET`) sent as a query param or header — neither Plex nor Jellyfin support signing outgoing webhooks, so this is the strongest verification available. Treat `WEBHOOK_SECRET` like a password and **do not expose these endpoints to the public internet**; keep them reachable only from your LAN/reverse-proxy-internal network, where Plex/Jellyfin themselves run. If you must route them through a reverse proxy, set `WEBHOOK_ALLOWED_IPS` to a comma-separated allowlist of your Plex/Jellyfin server IPs (requires `TRUST_PROXY` to be configured correctly) as a second layer of defense. Where you put the secret matters — see [Webhook secret placement](#webhook-secret-placement).
- Container logs are capped at 10MB × 3 files per service (`docker-compose.yml`'s `x-logging` block) so they can't grow unbounded on the host over a long-running, unattended deployment.

### Webhook secret placement

`WEBHOOK_SECRET` can travel two ways, and they are not equally safe:

| Form | Use it when | Why |
| --- | --- | --- |
| `x-webhook-secret` header | Your media server can set custom headers — **Jellyfin can** | Headers are not part of the URL, so nothing logs them |
| `?token=` query parameter | Your media server cannot — **Plex cannot** | The URL is written to every access log on the way in |

Anything in a query string ends up in access logs in plaintext, and those logs are kept far longer than the request. Cataloggy redacts `token` from its own logs (`?token=REDACTED`), but a reverse proxy in front of it keeps its own copy that Cataloggy cannot reach. **Prefer the header wherever the sender supports it.** If both are sent, the header is what's checked; the API also logs a one-time warning per process when a webhook authenticates via the query string.

Jellyfin's Webhook plugin has a *Headers* section — add `x-webhook-secret` with your secret there and drop `token` from the URL:

```text
http://LAN-IP:7000/webhooks/jellyfin?profile=PROFILE-ID
```

Plex has no such field, so `?token=WEBHOOK_SECRET` is the only form it can send. If your proxy logs concern you, either keep the Plex webhook off the proxy entirely (point it straight at the API on your LAN) or configure the proxy to strip query strings from its access log format.

## Useful Commands

- Run apps in dev mode from root:

  ```bash
  pnpm dev
  ```

- Run builds:

  ```bash
  pnpm build
  ```

- Run typechecks:

  ```bash
  pnpm typecheck
  ```

- Push Prisma schema to DB (API package):

  ```bash
  pnpm --filter @cataloggy/api prisma:push
  ```

## Contributing

Want to contribute? See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, checks to run before opening a PR, and how to report bugs. Notable changes are tracked in [CHANGELOG.md](CHANGELOG.md).

Before filing a bug, it's worth checking [docs/troubleshooting.md](docs/troubleshooting.md) — most reports turn out to be a public URL still pointing at `localhost`.

## Author

Created and maintained by [TheShield2594](https://github.com/TheShield2594).

## License

Cataloggy is licensed under the [MIT License](LICENSE).
