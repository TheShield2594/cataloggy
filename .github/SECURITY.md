# Security Policy

## Supported versions

Cataloggy ships as tagged releases (`vX.Y.Z`), each one a set of Docker images
you can pin `CATALOGGY_IMAGE_TAG` to — see [docs/releasing.md](../docs/releasing.md).
Fixes land on `main` and go out in the next release. Nothing is backported, and
no tag is ever re-published: upgrading forward is the only way to get a fix.

| What you're running | Fixes reach it |
| --- | --- |
| The newest release (`vX.Y.Z`, top of [Releases](https://github.com/TheShield2594/cataloggy/releases)) | Yes, in the next release |
| `main` / the `latest` image tag | Yes, first |
| Any earlier `vX.Y.Z` or `sha-` tag | No — upgrade to the newest release |

If you are pinned to an older tag for a reason, say so in your report; it
doesn't change the fix, but it tells me whether an upgrade is a usable answer
for you.

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting:

**→ [Report a vulnerability](https://github.com/TheShield2594/cataloggy/security/advisories/new)**

That opens a draft advisory visible only to you and the maintainer. If it isn't
available to you, contact [the maintainer](https://github.com/TheShield2594)
privately instead.

What makes a report quick to act on:

- The version or image tag, and how you're running it — Docker Compose or local
  dev, what sits in front of it, and whether anything is reachable beyond your
  LAN.
- **What the attacker has to start with**: nothing, LAN access, a browser tab on
  the app, `API_TOKEN`, a profile's add-on URL. This is the single most useful
  line in a report, because it's what decides whether a finding is inside the
  threat model below.
- Steps to reproduce, and what you were able to read, write or reach.

Redact secrets from anything you paste — `API_TOKEN`, `WEBHOOK_SECRET`,
`POSTGRES_PASSWORD`, OAuth tokens, a Stremio access key — and rotate anything
already exposed. Note that rotating `API_TOKEN` invalidates every stored
credential, every add-on URL and every profile access token; the README's
[Secrets at rest](../README.md#secrets-at-rest) section covers what that costs.

## What to expect

One person maintains this in their spare time, so there is no SLA to promise
and I'd rather not invent one. In practice: an acknowledgement once I've seen
it, an assessment of whether it falls inside the threat model, and for what
does, a fix on `main` and a `### Security` entry in
[CHANGELOG.md](../CHANGELOG.md) naming what changed and what it means for
someone running it. You'll be credited in the advisory and the changelog unless
you'd rather not be.

## Threat model

Cataloggy is built for self-hosting on a trusted local network, **not** for
direct exposure to the internet. [The README's Security
section](../README.md#security) is the full statement — known limitations,
what's encrypted at rest, which routes are rate-limited, and why the add-on
service is unauthenticated. Read it before reporting: several things that look
like findings are documented, deliberate trade-offs, and the section says why.

The distinction that matters most: **the separate add-on service on port 7001
is unauthenticated by design.** The Stremio add-on protocol cannot send
credentials, so anyone who can reach that port can read the lists of the
profile named in its URL. That is inherent to the protocol, not a bug — keep
the port on your LAN.

### In scope

- Reaching data or an endpoint without the credential it's supposed to need —
  including using one profile's credential to read or write another's.
- Bypassing `API_TOKEN`, a profile PIN, the derived add-on URL secret, the
  add-on service's scrobble token, or a "Mark Watched" capability URL (forging
  one, or widening one beyond the single title and twelve hours it was signed
  for).
- Reading stored credentials out of a database copy without `API_TOKEN` — a
  weakness in the AES-256-GCM/HKDF scheme or its per-column binding.
- SSRF through any user-supplied URL — an AI provider endpoint, a notification
  channel — including a way past the cloud-metadata and link-local checks, or
  a DNS-rebinding window between the check and the request.
- Webhook authentication bypass on `/webhooks/plex` or `/webhooks/jellyfin`.
- OAuth CSRF or account-binding problems in the Trakt or Stremio Watched Sync
  flows.
- XSS, CSP bypass, or any route that gets the browser's bearer token off the
  page.
- SQL injection, path traversal, unauthenticated writes, or a bypass of the
  per-route rate limits.
- A dependency vulnerability you can show is reachable from Cataloggy's own code
  paths.

### Out of scope

These are documented positions rather than oversights. If you think one of them
is wrong, an issue arguing that is welcome — it just isn't a vulnerability
report.

- The bearer token living in `localStorage`, and what an XSS bug could therefore
  do with it. The README states the trade-off and the stronger fix.
- The add-on service on port 7001 being unauthenticated, and anything that
  follows from choosing to expose it.
- Anything that assumes the attacker can already run code as the `api`
  container or read its environment. The process holds the encryption key
  because it needs it to serve a single request.
- Consequences of exposing Cataloggy to the internet without TLS and a reverse
  proxy in front of it.
- `WEBHOOK_SECRET` appearing in a reverse proxy's access log when sent as
  `?token=`, which is the only form Plex can send. The header form is the
  documented fix where the sender supports it.
- Hardening that belongs to the edge: hostname filtering, TLS termination, IP
  allowlisting. There is no host allowlist inside the `web` container by
  design — the reverse proxy owns that.
- Rate-limit budgets not being shared across multiple `api` replicas. The
  limiter is in-memory, and one `api` container is the documented deployment.
- Scanner output with no demonstrated impact here, and `pnpm audit` findings for
  advisories that no Cataloggy code path reaches.
