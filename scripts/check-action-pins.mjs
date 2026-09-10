#!/usr/bin/env node
// Every third-party action in this repo is pinned to a commit SHA, with the
// human-readable version in a trailing comment:
//
//   uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10
//
// The SHA is what GitHub enforces; the comment is the only thing a reviewer
// actually reads. So the comment being true is the whole value of the pin —
// and nothing was checking it. Two ways it had already gone wrong:
//
//   * One SHA, two versions. Dependabot rewrites the comment by matching the
//     old `uses:` string, so when security.yml and ci.yml pinned the same
//     action at *different* SHAs, one bump landed the new SHA in both files
//     but only corrected the comment in one. The repo then claimed the same
//     SHA was both v6.0.9 and v6.0.10.
//   * One version, two SHAs. The state that caused the above: both files said
//     `# v6.0.9`, pointing at two unrelated commits. At most one was right.
//
// Neither needs the network to catch, so the consistency checks below always
// run. With `--verify-tags` (CI passes it) each pin is also resolved upstream,
// which is the only way to catch a comment that is wrong *everywhere*. That
// lookup is `git ls-remote` rather than the REST API: no token, no rate limit,
// and the `^{}` form peels an annotated tag to its commit for free, which is
// the form a pin has to match. A mismatch there is fatal; an unreachable
// remote is not, so a GitHub outage cannot block a merge.
//
// Run with `pnpm check:actions`, or `pnpm check:actions --verify-tags`.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKFLOW_ROOT = join(ROOT, ".github");
const VERIFY_TAGS = process.argv.includes("--verify-tags");

// `uses: owner/repo@ref` or `uses: owner/repo/sub/path@ref`, with the version
// comment optional here so an *absent* one is reported rather than skipped.
const USES = /^\s*(?:-\s+)?uses:\s*(\S+?)\s*(?:#\s*(\S+))?\s*$/;
const SHA = /^[0-9a-f]{40}$/;

function yamlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...yamlFiles(full));
    else if (/\.ya?ml$/.test(entry)) found.push(full);
  }
  return found.sort();
}

const problems = [];
/** @type {Map<string, { sha: string, version: string, sites: string[] }[]>} */
const byAction = new Map();

for (const file of yamlFiles(WORKFLOW_ROOT)) {
  const where = relative(ROOT, file);
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    const match = USES.exec(line);
    if (!match) return;
    const [, ref, version] = match;
    // A reusable workflow or composite action from this same repository moves
    // with the commit that calls it; there is nothing to pin it to.
    if (ref.startsWith("./") || ref.startsWith("docker://")) return;

    const site = `${where}:${index + 1}`;
    const at = ref.lastIndexOf("@");
    const action = at === -1 ? ref : ref.slice(0, at);
    const pin = at === -1 ? "" : ref.slice(at + 1);

    if (!SHA.test(pin)) {
      problems.push(
        `${site}: ${action} is pinned to "${pin || "nothing"}" rather than a ` +
          `40-character commit SHA. A tag or branch is whatever its owner ` +
          `repoints it at.`
      );
      return;
    }
    if (!version) {
      problems.push(`${site}: ${action}@${pin.slice(0, 7)} has no "# vX.Y.Z" comment saying what that SHA is.`);
      return;
    }

    // Sub-paths share the repository's tags and commits — github/codeql-action
    // /init and /analyze are one release — so they are grouped as one action.
    const [owner, repo] = action.split("/");
    const key = `${owner}/${repo}`;
    const pins = byAction.get(key) ?? [];
    const existing = pins.find((p) => p.sha === pin && p.version === version);
    if (existing) existing.sites.push(site);
    else pins.push({ sha: pin, version, sites: [site] });
    byAction.set(key, pins);
  });
}

const sitesOf = (pin) => pin.sites.join(", ");

for (const [action, pins] of byAction) {
  for (const sha of new Set(pins.map((p) => p.sha))) {
    const claims = pins.filter((p) => p.sha === sha);
    if (claims.length < 2) continue;
    problems.push(
      `${action}@${sha.slice(0, 7)} is one commit, but the workflows call it ` +
        claims.map((c) => `${c.version} (${sitesOf(c)})`).join(" and ") +
        `. At most one is true.`
    );
  }
  for (const version of new Set(pins.map((p) => p.version))) {
    const claims = pins.filter((p) => p.version === version);
    if (claims.length < 2) continue;
    problems.push(
      `${action} ${version} is pinned to ` +
        claims.map((c) => `${c.sha.slice(0, 7)} (${sitesOf(c)})`).join(" and ") +
        `. At most one is that release.`
    );
  }
}

// Resolves a tag to the commit it names, or null if the remote has no such
// tag. An annotated tag is an object of its own pointing at the commit, and
// `refs/tags/X^{}` is that dereference — which is what a SHA pin has to be,
// since a pin on the tag object itself is not a commit. A lightweight tag has
// no peeled form and names the commit directly.
function tagCommit(action, tag) {
  const output = execFileSync(
    "git",
    ["ls-remote", "--tags", `https://github.com/${action}`, tag, `${tag}^{}`],
    { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }
  );
  const refs = new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t").reverse())
  );
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null;
}

let unverified = 0;
if (VERIFY_TAGS) {
  const unreachable = [];
  for (const [action, pins] of byAction) {
    for (const pin of pins) {
      let commit;
      try {
        commit = tagCommit(action, pin.version);
      } catch (err) {
        unreachable.push(`${action} ${pin.version}: ${err instanceof Error ? err.message.trim() : err}`);
        unverified++;
        continue;
      }
      if (commit === null) {
        problems.push(`${action} has no tag ${pin.version}, but ${sitesOf(pin)} says its pin is that release.`);
      } else if (commit !== pin.sha) {
        problems.push(
          `${action} ${pin.version} is commit ${commit.slice(0, 7)}, but ${sitesOf(pin)} ` +
            `pins ${pin.sha.slice(0, 7)} and calls it that.`
        );
      }
    }
  }
  if (unreachable.length > 0) {
    // Not a failure: the consistency checks above already ran offline, and a
    // github.com outage is not a reason that nothing in the repo can merge.
    console.warn(`! Could not reach ${unreachable.length} action remote(s); their tags went unverified:`);
    for (const line of unreachable) console.warn(`    ${line}`);
  }
}

if (problems.length > 0) {
  console.error(`Action pins and the versions they claim to be disagree:\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error(
    `\nFix the comment to match the SHA (compare against the action's releases), ` +
      `not the SHA to match the comment — the SHA is what has been reviewed.`
  );
  process.exit(1);
}

const pinned = [...byAction.values()].reduce((total, pins) => total + pins.length, 0);
const verified = VERIFY_TAGS ? pinned - unverified : 0;
const suffix = VERIFY_TAGS ? `, ${verified} of them confirmed against the action's own tags` : "";
console.log(`✓ ${pinned} action pin(s) across ${byAction.size} action(s) agree on what they are${suffix}.`);
