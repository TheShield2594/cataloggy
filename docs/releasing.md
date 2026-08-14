# Releasing

Cataloggy's operating advice is "pin the version you run, and roll back if an
update breaks it". That advice needs versions to exist. This is how one is cut.

- [Why tags matter here](#why-tags-matter-here)
- [Cutting a release](#cutting-a-release)
- [What the tag push does](#what-the-tag-push-does)
- [Cadence and numbering](#cadence-and-numbering)
- [Writing changelog entries](#writing-changelog-entries)
- [If a release turns out to be broken](#if-a-release-turns-out-to-be-broken)

## Why tags matter here

A self-hoster on `:latest` follows every build of `main`. `docker compose pull`
can move them onto a build nobody has run yet, and when it goes wrong the
recovery procedure in the README — "roll back to the previous working image
tag" — has nothing to point at except a 12-character sha they have to find in
the GHCR tag list. The bug report template asks for a version; without tags the
only honest answer is `latest`.

Tags are also what attaches a fix to something a person can name. "Does the
build I'm running have the profile-PIN fix?" is answerable against `v0.1.0` and
unanswerable against a changelog with one open `[Unreleased]` heading.

## Cutting a release

Everything happens on `main`, after the work being released is merged.

1. **Set the version.** All six `package.json` files carry it, and nothing keeps
   them in step but this script:

   ```bash
   pnpm version:set 0.2.0
   pnpm version:set --check   # asserts they agree, e.g. from CI or a hook
   ```

2. **Close the changelog.** Rename `## [Unreleased]` to `## [0.2.0] - YYYY-MM-DD`
   (UTC), open a fresh empty `[Unreleased]` above it, and add both link
   definitions at the bottom of the file:

   ```markdown
   [Unreleased]: https://github.com/TheShield2594/cataloggy/compare/v0.2.0...HEAD
   [0.2.0]: https://github.com/TheShield2594/cataloggy/compare/v0.1.0...v0.2.0
   ```

3. **Commit and push** the version bump and the changelog together, so the tag
   points at a commit that describes itself.

   ```bash
   git commit -am "Release 0.2.0"
   git push origin main
   ```

4. **Tag and push the tag.** The tag name is the image tag, `v` included —
   `CATALOGGY_IMAGE_TAG=v0.2.0` is what a self-hoster will write.

   ```bash
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

5. **Write the GitHub release** against the tag, with the changelog section for
   that version as the body. This is the page people land on from the repo, and
   it is what makes the tag discoverable at all.

## What the tag push does

`.github/workflows/dockerpublish.yml` triggers on `v*` tags as well as on
pushes to `main`. On a tag it runs the same verification job as CI — including
applying every Prisma migration against a real Postgres, because an image
published past a broken migration leaves a self-hoster with an API that never
starts — and then publishes each of the four images (`api`, `migrate`, `addon`,
`web`) three times over:

| Tag | Moves | Use |
| --- | --- | --- |
| `latest` | Every build of `main` | Trying it out |
| `sha-<short-sha>` | Never | Pinning to an exact commit |
| `vX.Y.Z` | Never | Pinning to a release |

Keep all four images on the same tag: the `migrate` image applies the schema the
`api` image expects.

## Cadence and numbering

Monthly is the target. At roughly 40 commits a week, a longer gap makes the
release notes unreadable and a shorter one makes them not worth reading.

Numbering is semver as it applies to an application rather than a library — the
public surface is the HTTP API, the environment variables, the compose file and
the database schema:

- **Patch** — fixes and internal changes. Pull, restart, nothing else to do.
- **Minor** — new features, new optional environment variables, additive schema
  changes. Still a pull-and-restart.
- **Major** — anything that needs a self-hoster to act: a removed or renamed
  environment variable, a breaking API change, a migration that cannot be rolled
  back. Say so at the top of the changelog entry.

A release that needs manual steps says so in the release body, not only in the
changelog.

## Writing changelog entries

**One to three sentences per entry.** Name what changed and what it means for
someone running it; link the PR for the reasoning. The design notes, the
alternatives considered and the failure mode that motivated the change belong in
the PR description, where anyone digging can find them, and where they do not
stand between a reader and the next entry.

The audience is someone deciding whether to upgrade, reading the file top to
bottom. Entries from before 0.1.0 are longer than this — they are kept as they
were written rather than rewritten, since editing shipped history to match a
convention adopted later just loses information.

Group under Keep a Changelog's headings (`Added`, `Changed`, `Deprecated`,
`Removed`, `Fixed`, `Security`) and lead with the user-visible half:

```markdown
### Fixed

- A TMDB rate limit no longer empties a catalog. Outbound requests now retry
  with backoff and are capped per host, so a burst of catalog requests waits
  rather than failing ([#470](https://github.com/TheShield2594/cataloggy/issues/470)).
```

## If a release turns out to be broken

Tags are immutable once anyone has pulled them — retagging `v0.2.0` at a
different commit gives two people the same tag and different images. Cut
`v0.2.1` instead.

Tell people what to roll back to. The recovery procedure in the README covers a
failed migration specifically, and it depends on the previous release still
being pullable, which it is: nothing deletes published tags.
