# CataLoggy Monorepo

CataLoggy is a Node.js monorepo set up with `pnpm` workspaces.

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

1. Edit `docker-compose.yml` and set your values directly in the `environment:` blocks:

   - **Required:** `API_TOKEN` (in `api` and `addon` services — keep them matching)
   - **Recommended for LAN devices** (phone/Apple TV): update the URLs in `api`, `addon`, and `web` services to use your LAN IP instead of `localhost`
   - **Optional integrations:** `TMDB_API_KEY`, `TRAKT_CLIENT_ID`, `TRAKT_CLIENT_SECRET` (in `api` service)

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
- Postgres: `localhost:5432` (`postgres` / `postgres`, db `cataloggy`)


## Use on Your Local Network (Phone + Apple TV)

### Find your LAN IP (brief)

Your LAN IP is your computer's local network address (usually like `192.168.x.x` or `10.0.x.x`).

- **macOS:** System Settings → Network → select active connection → look for **IP Address**
- **Windows:** Command Prompt → `ipconfig` → look for **IPv4 Address**
- **Linux:** Terminal → `hostname -I`

### Open CataLoggy on your phone

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

### Install Omni add-on on Apple TV

Use this add-on URL in Omni:

```text
http://LAN-IP:7001/manifest.json
```

> **Important:** Apple TV cannot use `localhost` URLs. The add-on URL must be reachable on your LAN from Apple TV.

## Nginx Proxy Manager Setup

Configure Nginx Proxy Manager with one Proxy Host for your domain (for example, `cataloggy.domain.com`):

- **Proxy Host target:** web service on port `7002`
- **Advanced locations:**
  - `/api/` → port `7000`
  - `/addon/` → port `7001`

Use this Omni add-on URL to install when accessing through your domain:

```text
https://cataloggy.domain.com/addon/manifest.json
```

LAN development URLs stay available, so you can continue using direct local access like `http://LAN-IP:7002` and `http://LAN-IP:7001/manifest.json` on your network.

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
