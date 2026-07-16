# Working in this repo

## Git commit authorship

Author and commit all commits as the repo owner, not as Claude:

```bash
git config user.name "TheShield2594"
git config user.email "82059300+TheShield2594@users.noreply.github.com"
```

Run this once at the start of a session before committing (local git config isn't
persisted between sessions in this environment). Do not add a `Co-Authored-By:
Claude` trailer, or any other Claude/Anthropic attribution, to commit messages.
