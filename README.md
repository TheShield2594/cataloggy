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

## Setup

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Prepare environment file:

   ```bash
   cp .env.example .env
   ```

   Set `TMDB_API_KEY` in `.env` if you plan to use the search/meta endpoints.

3. Start everything with Docker Compose:

   ```bash
   docker compose up --build
   ```

4. Run the smoke checks:

   ```bash
   pnpm smoke
   ```

   This validates API and add-on health endpoints and (when all Trakt env vars are configured) runs `/trakt/import` and verifies a catalog response contains a `metas` array.

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
