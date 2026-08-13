# @cataloggy/shared

Types and utilities shared by the `api`, `addon` and `web` apps.

Anything here is, by definition, something more than one service has to agree
about — so the rule is that a fact lives here exactly once and every service
derives from it, rather than each keeping a copy that drifts.

| Module | What it owns |
| --- | --- |
| `catalogs.ts` | The Stremio catalog registry: which catalogs exist, their labels, types, and where each one's rows come from. Both manifests (the API's `/addon/stremio/…` routes and the `addon` service) and the Settings picker derive from it. |
| `api-contracts.ts` | The response shapes crossing the api→addon boundary, plus parsers the addon runs at that boundary. The API's handlers are annotated with the same types, so a shape change fails `pnpm typecheck` instead of emptying a Stremio row at runtime. |
| `proxy.ts` | Reverse-proxy path-prefix and `trustProxy` parsing, shared by both Fastify apps. |
| `sentry.ts` | Opt-in Sentry setup. |
| `service-client.ts` | The derived service token the addon proves itself to the API with. |
| `uuid.ts` | The UUID v4 pattern both services validate profile ids against. |

The package builds to `dist/` and both apps import it as `@cataloggy/shared`,
so `pnpm --filter @cataloggy/shared build` runs before anything typechecks
against it (`pnpm typecheck` at the root does this for you).
