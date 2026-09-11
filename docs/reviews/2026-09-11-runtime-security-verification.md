# Runtime verification of four unconfirmed security behaviours

Date: 2026-09-11 · Follows up [#515](https://github.com/TheShield2594/cataloggy/issues/515),
which collected the four items from the six-lens review in
[2026-08-12-multi-agent-review.md](2026-08-12-multi-agent-review.md) (commit `881669b`)
that a code read could not settle.

Each was checked by running the thing, not by reading it again. The point of writing the
results down is that three of the four turned out to be fine: without a record, the next
person reading the same code reaches the same suspicion and re-does the same work.

| # | Question | Verdict |
|---|---|---|
| 1 | Does the rate limiter see a request the auth hook rejects? | **Confirmed a real gap.** Fixed. |
| 2 | Is `bodyLimit` enforced before or after request decompression? | **After.** No gap, no change. |
| 3 | Does `serve` apply `serve.json`'s headers to the SPA fallback? | **Yes, everywhere.** No change. |
| 4 | Can `TRAKT_REDIRECT_URI` be influenced by a caller? | **No.** Consolidated to one helper. |

---

## 1. Rate-limit hook ordering vs. the auth hook — confirmed

**The suspicion.** `app.register(rateLimit, …)` is deferred to boot by Avvio while the auth
`app.addHook("onRequest", …)` ran synchronously at module load, so a 401'd request might
short-circuit before consuming any rate-limit budget.

**What the runtime says.** Confirmed, and the mechanism is worse than the issue supposed.
An instance mirroring `index.ts`'s wiring, with the limiter set to `max: 5`, answered
**20 consecutive wrong-token requests with 20 × 401 and zero 429s** — and a request with the
*correct* token straight afterwards still got a 200, i.e. the twenty had consumed no budget
at all.

The cause is not registration order, so neither of the fixes the issue proposed works.
`@fastify/rate-limit@11` does not install a global `onRequest` hook: it installs a
**route-level** one, from an `onRoute` listener (`node_modules/@fastify/rate-limit/index.js`,
the `fastify.addHook('onRoute', …)` near the end of the plugin). Fastify runs every
instance-level `onRequest` hook before any route-level one, so an auth hook added with
`addHook("onRequest", …)` wins no matter when the limiter is registered. Both
`await app.register(rateLimit, …)` before the hook and `app.after(() => …)` were measured:
both still gave 20 × 401, zero 429.

**The fix.** `lib/auth-gate.ts` — the allowlist and the hook, moved out of `index.ts` — puts
the gate on **`preParsing`**, the first phase that runs *after* route-level `onRequest`. The
same flood now answers 5 × 401 then 15 × 429, and per-route budgets (`/profiles` PIN verify,
the Trakt OAuth routes, the webhooks) are unaffected: a route with its own
`config.rateLimit` still gets exactly its own max.

`preParsing` rather than `preHandler`, which would also have fixed the ordering: `preParsing`
runs before the body is read off the wire, so an unauthenticated caller still cannot make the
server buffer up to `MAX_BODY_SIZE_MB` before being turned away. It also runs before
`@fastify/compress`'s request-decompression hook, which is route-level and therefore later.

Covered by `apps/api/src/lib/auth-gate.test.ts`. Both wrong phases were checked against it:
`onRequest` fails the two flood cases, `preHandler` fails the "answers before its body is
sent" case.

## 2. Decompression bombs — not a vulnerability

**The suspicion.** `@fastify/compress` is registered globally and does decompress request
payloads by default (confirmed: `processDecompressParams` defaults `global` to `opts.global`,
which `index.ts` sets to `true`). If Fastify's `bodyLimit` were enforced against the
pre-inflation stream, a small gzip could exceed the 32 MB ceiling in memory.

**What the runtime says.** The limit is enforced **post-inflation**. Against a 32 MB
`bodyLimit`, with bombs sent chunked so the `Content-Length` cross-check could not
short-circuit them:

| Inflates to | Compressed | Result | RSS growth |
|---|---|---|---|
| 8 MB | 8 KB | 200 | +34 MB |
| 31 MB | 31 KB | 200 | +76 MB |
| 33 MB | 33 KB | **413** | +2 MB |
| 512 MB | 510 KB | **413** | +0 MB |

The 512 MB bomb is refused in ~120 ms having allocated nothing measurable. `requestEncodings`
is left alone — the plugin rejects `[]` outright ("must have at least 1 item"), and
`["identity"]` would answer a gzipped body with 415, which is a behaviour change for no gain.

One methodological note, because it invalidated two earlier attempts at this: both this
plugin and the rate limiter attach their hooks from `onRoute` listeners, so a test that
registers its routes with `app.get(...)` *synchronously* — before the plugin has booted — gets
no decompression and no rate limiting at all, and reads as a clean bill of health. Routes have
to be registered as plugins, the way `index.ts` registers them, for either to be exercised.

## 3. `serve.json` headers on every path — confirmed correct

`serve@14` was run against a `dist/` with a `serve.json` rendered by the real
`scripts/render-serve-json.mjs` from the real `serve.template.json`. The `"source": "**"`
headers — CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` — were
present and identical on all of:

- `/` (the index)
- `/settings` (**the SPA fallback**, which was the actual question)
- `/nope/deep/path` (a deeper fallback)
- `/assets/app-abc123.js` (a hashed asset)
- `/manifest.webmanifest`

No change needed.

## 4. Trakt redirect URI — confirmed not influenceable

All three consumers (`/trakt/status`, `/trakt/oauth/authorize`, and the token exchange in
`/trakt/oauth/callback`) read `process.env.TRAKT_REDIRECT_URI`, falling back to
`CATALOGGY_API_PUBLIC`. A repo-wide grep for `TRAKT_REDIRECT_URI` finds those three, plus
`docker-compose.yml`, `.env.example` and one error message. No query parameter, header or body
reaches the value, so there is no open redirect through the OAuth flow; the single-use `state`
check in `lib/trakt-oauth-state.ts` covers the CSRF half.

The three copies of the same expression are now one function, `lib/trakt-redirect-uri.ts`. That
is not a security fix — it is what makes "this value comes from the environment and nothing
else" a claim with one place to check it, and it removes a drift that would otherwise be silent
until a token exchange failed with `invalid_grant`.
