# Contributing to Cataloggy

Cataloggy is a personal, self-hosted project. Contributions are welcome, but keep in mind it's built and maintained around one person's real usage — not every feature request will fit, and response time may be slow.

## Getting set up

```bash
pnpm install
pnpm --filter @cataloggy/api prisma:generate
pnpm dev
```

See the [README](README.md) for full setup instructions, including the Docker Compose path and required environment variables. You'll need a local Postgres instance (or `docker compose up db`) for the API to start.

The `prisma:generate` step writes the typed client the API's source imports, and
nothing in `node_modules` provides it until it runs. `dev` is the one command
that needs it spelled out: the API's `build`, `typecheck`, `lint` and `test`
scripts each run it themselves, because forgetting it doesn't look like a
missing build step — it looks like 300-odd failing tests and type errors in
files you never touched.

## Project structure

```text
cataloggy/
  apps/
    api/        # Fastify API + Prisma
    addon/      # Stremio/Omni addon service
    web/        # React + Vite PWA frontend
  packages/
    shared/     # shared types/utilities
    migrate/    # Prisma CLI only, for the migration image
```

Each app is its own pnpm workspace package with its own `package.json` scripts (`dev`, `build`, `typecheck`, `lint`, `test` where applicable). Run them from the repo root with `pnpm --filter @cataloggy/<app> <script>`, or use the root-level scripts (`pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`) to run across every workspace at once.

`packages/migrate` is the odd one out — no source, no build, no tests. It holds
a pinned `prisma` dependency and nothing else, so the migration image can be
built from a tree containing the Prisma CLI without the API's test and build
toolchain: 226 MB against 470 MB, and it is also why the CLI is not a
dependency of the API image. The schema and migrations still live with
`@cataloggy/api`. See
[packages/migrate/README.md](packages/migrate/README.md) — it is one of the
four images `.github/workflows/dockerpublish.yml` builds, and all four have to
stay on the same `CATALOGGY_IMAGE_TAG`.

## Before opening a PR

Run the same checks CI runs:

```bash
pnpm check:env
pnpm check:actions
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int   # needs DATABASE_URL_TEST — see "Integration tests" below
pnpm build
```

`apps/api`, `apps/addon` and `apps/web` tests all need `@cataloggy/shared` built first if you haven't run `pnpm typecheck`/`pnpm build` yet — `pnpm --filter @cataloggy/shared build` handles that. (`pnpm lint` and `pnpm typecheck` build it themselves, and `pnpm build` and CI reach it in dependency order.)

Tests live next to the code they cover as `*.test.ts`/`*.test.tsx`. `apps/api` and `apps/addon` run in a Node environment; `apps/web` runs in jsdom with Testing Library, with shared setup (jest-dom matchers, cleanup, and stubs for the browser APIs jsdom lacks) in `apps/web/src/test/setup.ts`.

### Integration tests

`pnpm test` mocks Prisma everywhere, which leaves out the part of the schema that only exists in migration SQL: the partial unique indexes (the default watchlist and collection singletons, the watch-event dedup key), the `onDelete: Cascade` rules, the check constraints, and the column types. `apps/api/src/**/*.int.test.ts` covers those against a real Postgres:

```bash
DATABASE_URL_TEST=postgresql://postgres:postgres@127.0.0.1:5432/cataloggy_int pnpm test:int
```

The database is created and migrated for you; it just has to be a database you don't mind losing, because **every table is truncated between tests**. That is why the suite takes its own variable and refuses to run against `DATABASE_URL` — the one the README has you point at your own library. It is a separate command from `pnpm test` for the same reason, and CI runs it as its own step.

Reach for an integration test when the thing you would be asserting is Postgres's answer rather than your code's question — a constraint holding, a cascade reaching, a query returning the row you meant. Everything else belongs in a unit test, which is faster and needs no database.

For changes that touch a running feature (not just types/tests), actually exercise it — start the stack with `pnpm dev` (or `docker compose up`) and click through the affected flow. Type checks and unit tests catch a lot, but not everything.

If your change reads a new environment variable, add it to the `environment:` block of every `docker-compose.yml` service that runs the code — compose substitutes `.env` into the compose file, it does not forward the file into containers, so a variable that is only in `.env.example` reaches nothing. `pnpm check:env` compares the two sides and is what CI runs.

The web client asserts its response types rather than checking them (`response.json() as Promise<T>`), which is fine for the ~87 shapes whose worst case is a blank field. Three are parsed instead — `GET /calendar`, `GET /series/progress` and `GET /watch/history` — because each is destructured without a guard on a hot path, and a self-hosted install can legitimately run a `web` image against an `api` image from another build. Those contracts live in `packages/shared/src/api-contracts.ts` alongside the api↔addon ones, in the same hand-written style (no schema library); if you change one of those three responses on either side, change the parser with it. Reach for a new contract when a missing field would throw rather than render blank — not for every endpoint.

If your change touches `.github/workflows/`, every third-party action stays pinned to a 40-character commit SHA with the release in a trailing comment (`# v6.0.10`). The SHA is what GitHub enforces and the comment is the only part a reviewer reads, so `pnpm check:actions` holds them together: it fails on an unpinned or uncommented `uses:`, and on one SHA carrying two different version comments across files — which is how a Dependabot bump had already left the repo claiming one commit was both v6.0.9 and v6.0.10. CI adds `--verify-tags`, which resolves each pin against the action's own tags with `git ls-remote` and so also catches a comment that is wrong everywhere; an unreachable remote warns rather than failing the build.

If a `pnpm audit` advisory has no fix to upgrade to, it can be waived in [.github/audit-allowlist.json](.github/audit-allowlist.json) with the GHSA id, a reason and an expiry date no more than 90 days out. Prefer an override in `pnpm-workspace.yaml` whenever one reaches the vulnerable package — the waiver is for the case where nothing upstream exists yet, so that a single new disclosure cannot freeze every merge including its own fix. `pnpm check:audit` enforces the expiry, and fails on a waiver that no longer matches anything so the file stays a description of the present.

If your change adds a Prisma migration, make sure it applies cleanly against a fresh database (`pnpm --filter @cataloggy/api exec prisma migrate deploy`) — CI runs every migration against a real Postgres instance and will fail if it doesn't.

If your change is worth knowing about before upgrading — a feature, a
behavioural change, a fix, anything security-related — add an entry to the
`[Unreleased]` section of `CHANGELOG.md` under the appropriate heading. One to
three sentences naming what changed and what it means for someone running it,
with a link to the PR for the reasoning; the design notes belong in the PR
description, where anyone digging can find them. Releases are cut from that
section — see [docs/releasing.md](docs/releasing.md).

## Commit style

Write commit messages that explain *why*, not just *what* — the diff already shows what changed. Imperative mood (`Fix ...`, `Add ...`, not `Fixed`/`Added`) is preferred, matching the existing history. No fixed prefix convention is enforced.

## Reporting bugs / requesting features

Open a GitHub issue. For bugs, include: what you expected, what happened instead, and relevant logs (`docker compose logs api`/`addon`/`web`). For self-hosting/environment issues, mention how you're running it (Docker Compose vs. local dev) and your `.env` configuration with secrets redacted.

## Security issues

Please don't open a public issue for a security vulnerability. **[SECURITY.md](.github/SECURITY.md)** is the policy: where to report privately, which versions get fixes, and — the part worth reading before you write anything — what's in and out of the threat model. Cataloggy is designed for trusted-LAN self-hosting rather than public internet exposure, so a few things that look like findings are documented trade-offs, and the [Security section of the README](README.md#security) says why.

Report via [a private advisory](https://github.com/TheShield2594/cataloggy/security/advisories/new), which is visible only to you and [the maintainer](https://github.com/TheShield2594).
