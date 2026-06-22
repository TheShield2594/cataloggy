# Cataloggy Monorepo

Cataloggy is a Node.js monorepo set up with `pnpm` workspaces.

## Structure

```text
cataloggy/
  apps/
    api/        # Fastify API + Prisma
    addon/      # Stremio/Omni addon service
  packages/
    shared/     # shared types/utilities
  docker-compose.yml
  README.md
```

## Requirements

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

## Docker Compose install (recommended)

1. Copy `.env.example` to `.env` next to `docker-compose.yml` and fill in real values:

   ```bash
   cp .env.example .env
   ```

   - **Required:** `API_TOKEN` and `POSTGRES_PASSWORD` — `docker compose up` will refuse to start without them (used by both `api` and `addon` services — they share the same `API_TOKEN`). Generate a token with `openssl rand -hex 32`.
   - **Recommended for LAN devices** (phone/Apple TV): update the URLs in `api`, `addon`, and `web` services to use your LAN IP instead of `localhost`
   - **Optional integrations:** `TMDB_API_KEY`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` (in `api` service)
   - **Optional:** `ALLOWED_HOSTS` (in `web` service) — comma-separated hostnames allowed to reach the web server beyond IPs/localhost, e.g. a domain proxied via Nginx Proxy Manager (see below). Leave unset for LAN-IP-only access.

   **Internal vs. public URLs:** the `api` and `addon` services distinguish between the URL used for service-to-service traffic inside the Docker network and the URL your browser/Apple TV/Omni actually reach:

   - `CATALOGGY_API_BASE` (addon service) — internal URL the addon uses to call the API (e.g. `http://api:7000`). Only needs to change if you rename the `api` service or run it elsewhere.
   - `CATALOGGY_API_PUBLIC` (api service) — externally reachable URL for the API, used to build the Trakt OAuth redirect URI. Set this to the LAN IP or domain you actually use to reach the API.
   - `ADDON_PUBLIC_BASE` (addon service) — externally reachable URL for the addon, used when generating manifest/catalog URLs for clients like Apple TV.

2. Start everything:

   ```bash
   docker compose up --build
   ```

3. Run the smoke checks:

   ```bash
   pnpm smoke
   ```

   This validates API and add-on health endpoints and (when all Trakt env vars are configured) runs `/trakt/import` and verifies a catalog response contains a `metas` array.

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

The web app itself also installs fine as a PWA on Android TV browsers that support it, but the Stremio app gives a better remote-control-friendly experience for browsing/playback on a TV.

## Nginx Proxy Manager Setup

Configure Nginx Proxy Manager with one Proxy Host for your domain (for example, `cataloggy.domain.com`):

- **Proxy Host target:** web service on port `7002`
- **Advanced locations:**
  - `/api/` → port `7000`
  - `/addon/` → port `7001`

Set `ALLOWED_HOSTS=cataloggy.domain.com` in your `.env` so the web service accepts requests for that hostname, then restart the `web` service.

Use this Omni add-on URL to install when accessing through your domain:

```text
https://cataloggy.domain.com/addon/manifest.json
```

LAN development URLs stay available, so you can continue using direct local access like `http://LAN-IP:7002` and `http://LAN-IP:7001/manifest.json` on your network.

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

### Export / import your data

In addition to full database backups, Settings → Data lets you export your lists, watch history, series progress, and ratings as a single JSON file, and re-import it later (e.g. after a fresh install, or to migrate to a new instance). The API also accepts CSV watch-history imports (columns: `imdbId`, `type`, `watchedAt`, with optional `season`/`episode`) for importing history exported from other tools.

## Security

Cataloggy is designed for self-hosting on a trusted local network (LAN), not for direct exposure to the internet. Known limitations:

- The web client stores its API bearer token in `localStorage`. Any JavaScript running on the page (e.g. via an XSS vulnerability in a dependency) could read this token. Since the token only grants access to your own local API, this is an acceptable tradeoff for a LAN-only app. If exposing it via a reverse proxy, both the API and web client now send a restrictive `Content-Security-Policy` (no inline scripts, no framing) plus `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy` headers to reduce the impact of a dependency-introduced XSS bug, but migrating to httpOnly session cookies would be a stronger fix if you need this on the internet.
- If you do expose Cataloggy beyond your LAN, put it behind a reverse proxy with TLS (e.g. Nginx Proxy Manager) and consider implementing a proper session-based auth flow.
- All API routes are rate-limited globally (200 req/min/IP), with tighter per-route limits on sensitive endpoints: PIN verification (`POST /profiles/:id/verify`, 10/min/IP) and the Plex/Jellyfin webhooks (60/min/IP).
- The Plex/Jellyfin webhook endpoints (`/webhooks/plex`, `/webhooks/jellyfin`) authenticate with a single shared secret (`WEBHOOK_SECRET`) sent as a query param or header — neither Plex nor Jellyfin support signing outgoing webhooks, so this is the strongest verification available. Treat `WEBHOOK_SECRET` like a password and **do not expose these endpoints to the public internet**; keep them reachable only from your LAN/reverse-proxy-internal network, where Plex/Jellyfin themselves run. If you must route them through a reverse proxy, set `WEBHOOK_ALLOWED_IPS` to a comma-separated allowlist of your Plex/Jellyfin server IPs (requires `TRUST_PROXY` to be configured correctly) as a second layer of defense.

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
