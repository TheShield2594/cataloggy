# Contributing to Cataloggy

Cataloggy is a personal, self-hosted project. Contributions are welcome, but keep in mind it's built and maintained around one person's real usage — not every feature request will fit, and response time may be slow.

## Getting set up

```bash
pnpm install
pnpm --filter @cataloggy/api prisma:generate
pnpm dev
```

See the [README](README.md) for full setup instructions, including the Docker Compose path and required environment variables. You'll need a local Postgres instance (or `docker compose up db`) for the API to start.

## Project structure

```text
cataloggy/
  apps/
    api/        # Fastify API + Prisma
    addon/      # Stremio/Omni addon service
    web/        # React + Vite PWA frontend
  packages/
    shared/     # shared types/utilities
```

Each app is its own pnpm workspace package with its own `package.json` scripts (`dev`, `build`, `typecheck`, `lint`, `test` where applicable). Run them from the repo root with `pnpm --filter @cataloggy/<app> <script>`, or use the root-level scripts (`pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`) to run across every workspace at once.

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm check:env
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`apps/api` tests need `@cataloggy/shared` built first if you haven't run `pnpm typecheck`/`pnpm build` yet — `pnpm --filter @cataloggy/shared build` handles that.

Tests live next to the code they cover as `*.test.ts`/`*.test.tsx`. `apps/api` and `apps/addon` run in a Node environment; `apps/web` runs in jsdom with Testing Library, with shared setup (jest-dom matchers, cleanup, and stubs for the browser APIs jsdom lacks) in `apps/web/src/test/setup.ts`.

For changes that touch a running feature (not just types/tests), actually exercise it — start the stack with `pnpm dev` (or `docker compose up`) and click through the affected flow. Type checks and unit tests catch a lot, but not everything.

If your change reads a new environment variable, add it to the `environment:` block of every `docker-compose.yml` service that runs the code — compose substitutes `.env` into the compose file, it does not forward the file into containers, so a variable that is only in `.env.example` reaches nothing. `pnpm check:env` compares the two sides and is what CI runs.

If your change adds a Prisma migration, make sure it applies cleanly against a fresh database (`pnpm --filter @cataloggy/api exec prisma migrate deploy`) — CI runs every migration against a real Postgres instance and will fail if it doesn't.

## Commit style

Write commit messages that explain *why*, not just *what* — the diff already shows what changed. Imperative mood (`Fix ...`, `Add ...`, not `Fixed`/`Added`) is preferred, matching the existing history. No fixed prefix convention is enforced.

## Reporting bugs / requesting features

Open a GitHub issue. For bugs, include: what you expected, what happened instead, and relevant logs (`docker compose logs api`/`addon`/`web`). For self-hosting/environment issues, mention how you're running it (Docker Compose vs. local dev) and your `.env` configuration with secrets redacted.

## Security issues

Please don't open a public issue for a security vulnerability. See the [Security section of the README](README.md#security) for Cataloggy's threat model (it's designed for trusted-LAN self-hosting, not public internet exposure) — if you've found something outside that model, reach out to [the maintainer](https://github.com/TheShield2594) privately first (e.g. via a GitHub private security advisory on this repo) rather than filing a public issue.
