# @cataloggy/migrate

Holds nothing but a pinned `prisma` dependency. It exists so the migration
image can be built from a dependency tree containing the Prisma CLI and
nothing else.

The schema and migrations stay with `@cataloggy/api`, which owns them —
`apps/api/Dockerfile` copies `apps/api/prisma` and `apps/api/prisma.config.ts`
into this package's deployed tree when it builds the `migrate` target. There
is no second copy of the schema to keep in sync.

Without this package the migration image would have to be built from the API's
full dependency tree, which carries its test and build toolchain: 470 MB
against 226 MB here. The API service image, in turn, stays small precisely
because the CLI is not one of its dependencies — see the comments in
`apps/api/Dockerfile` and `pnpm-workspace.yaml`.

Nothing imports this package, and it has no source, no build and no tests.
