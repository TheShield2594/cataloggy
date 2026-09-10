## What and why

<!--
The diff already says what changed. Say why: what was wrong or missing, and why
this is the shape of the fix. If you considered another approach and rejected
it, that's worth a line — it's the thing nobody can reconstruct later.
-->

Closes #

## Checks

The seven CI runs, in one line:

```bash
pnpm check:env && pnpm check:actions && pnpm lint && pnpm typecheck && pnpm test && \
  DATABASE_URL_TEST=postgresql://postgres:postgres@127.0.0.1:5432/cataloggy_int pnpm test:int && \
  pnpm build
```

- [ ] `pnpm check:env`
- [ ] `pnpm check:actions`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:int` — needs a Postgres and its own `DATABASE_URL_TEST`, because
      it truncates every table between tests. See CONTRIBUTING.md.
- [ ] `pnpm build`

## Manually exercised

<!--
Type checks and unit tests catch a lot, not everything. For anything that
touches a running feature, say what you actually did and on what — "started
`docker compose up -d`, marked an episode watched from the Shelf on a phone,
confirmed it appeared in History" beats a ticked box.
-->

- [ ] Started the stack (`pnpm dev`, or `docker compose up -d`) and clicked
      through the affected flow
- [ ] Not applicable — this change touches only types, tests or docs

## Where it applies

- [ ] **New environment variable** — added to the `environment:` block of every
      `docker-compose.yml` service that runs the code, and to `.env.example`
      (`pnpm check:env` compares the two)
- [ ] **New Prisma migration** — applies cleanly to a fresh database
      (`pnpm --filter @cataloggy/api exec prisma migrate deploy`)
- [ ] **Worth knowing about before upgrading** — entry added to `[Unreleased]`
      in `CHANGELOG.md`, under the right heading
- [ ] **Changes a documented command, variable, endpoint or flow** — `README.md`
      and `docs/` updated to match
