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

2. (Optional local API run) copy env values:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

3. Start everything with Docker Compose:

   ```bash
   docker compose up --build
   ```

## Services

- API: http://localhost:7000/health
- Addon: http://localhost:7001/manifest.json
- Postgres: `localhost:5432` (`postgres` / `postgres`, db `cataloggy`)

## Useful Commands

- Run apps in dev mode from root:

  ```bash
  pnpm dev
  ```

- Run typechecks:

  ```bash
  pnpm typecheck
  ```

- Push Prisma schema to DB (API package):

  ```bash
  pnpm --filter @cataloggy/api prisma:push
  ```
