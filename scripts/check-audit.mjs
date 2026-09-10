#!/usr/bin/env node
// `pnpm audit --audit-level=high`, with a time-boxed way to say "known, and
// there is nothing to upgrade to yet".
//
// The bare command was the whole gate, on every push and PR. Correct policy —
// but a newly-disclosed high-severity advisory anywhere in the transitive tree
// blocks *every* merge, including the one that would fix it, until an upstream
// release exists. That is not hypothetical here: this project sits on or ahead
// of the newest major of essentially everything it depends on, so it meets new
// advisories before the ecosystem has patched them, and pnpm-workspace.yaml
// already carries a row of `overrides` pinning exactly this class of problem.
// When an override is available it remains the right fix; this is for when one
// is not, and the alternatives are a merge freeze or deleting the gate.
//
// So: .github/audit-allowlist.json may waive an advisory, and every waiver
// needs a reason and an expiry date. The expiry is the point — it is what
// stops "temporarily ignore this" from becoming the permanent state nobody
// revisits. Once it passes, the advisory blocks merges again, exactly as if
// the waiver had never been written.
//
// The allowlist is held to the same standard as the audit itself:
//
//   * an expiry more than 90 days out is refused — a waiver nobody has to look
//     at again this quarter is a deletion of the gate with extra steps;
//   * a waiver matching no current advisory fails too, so the file describes
//     the present rather than accumulating history. That one is always fixed
//     by deleting a line, so it can never be what blocks a merge for long.
//
// Run with `pnpm check:audit`.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALLOWLIST = ".github/audit-allowlist.json";
// Matches the `--audit-level=high` this replaces.
const BLOCKING = new Set(["high", "critical"]);
const MAX_WAIVER_DAYS = 90;
// A waiver this close to lapsing is worth hearing about while there is still
// time to do something other than extend it.
const EXPIRING_SOON_DAYS = 14;

const DAY_MS = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10));
const daysUntil = (date) => Math.round((date.getTime() - today.getTime()) / DAY_MS);

function audit() {
  let output;
  try {
    output = execFileSync("pnpm", ["audit", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // pnpm exits non-zero whenever it found anything at all, so a failure here
    // is only real if it came back without a report to read.
    output = err.stdout ?? "";
    if (!output.trim()) {
      console.error(`Could not run \`pnpm audit\`:\n\n${err.stderr || err.message}`);
      process.exit(1);
    }
  }
  try {
    return Object.values(JSON.parse(output).advisories ?? {});
  } catch {
    console.error(`\`pnpm audit --json\` did not return a report:\n\n${output.slice(0, 2000)}`);
    process.exit(1);
  }
}

function loadWaivers() {
  const path = join(ROOT, ALLOWLIST);
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return parsed.allow ?? [];
}

const problems = [];
const notes = [];

// A waiver that does not survive this loop is left `valid: false` and then
// treated as absent — an entry nobody can read the terms of is not a decision
// to keep an advisory, so the advisory it names goes back to blocking rather
// than being quietly excused by a malformed line.
const waivers = loadWaivers();
const seen = new Set();
for (const [index, waiver] of waivers.entries()) {
  const at = `${ALLOWLIST} entry ${index + 1}`;
  waiver.valid = false;

  const missing = ["ghsa", "expires", "reason"].filter(
    (field) => typeof waiver[field] !== "string" || waiver[field].trim() === ""
  );
  for (const field of missing) {
    problems.push(`${at} has no "${field}". Every waiver needs the advisory, a date it lapses, and why it exists.`);
  }
  if (missing.includes("ghsa")) continue;

  if (seen.has(waiver.ghsa)) problems.push(`${at}: ${waiver.ghsa} is waived twice.`);
  seen.add(waiver.ghsa);
  if (missing.length > 0) continue;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(waiver.expires)) {
    problems.push(`${at}: "expires" must be a YYYY-MM-DD date, not "${waiver.expires}".`);
    continue;
  }
  const expires = new Date(waiver.expires);
  if (Number.isNaN(expires.getTime())) {
    problems.push(`${at}: "${waiver.expires}" is not a real date.`);
    continue;
  }
  const remaining = daysUntil(expires);
  if (remaining > MAX_WAIVER_DAYS) {
    problems.push(
      `${at}: ${waiver.ghsa} is waived until ${waiver.expires}, ${remaining} days out. ` +
        `The limit is ${MAX_WAIVER_DAYS} — a waiver has to come back for review.`
    );
    continue;
  }
  waiver.remaining = remaining;
  waiver.valid = true;
}

const advisories = audit();
const blocking = advisories.filter((advisory) => BLOCKING.has(advisory.severity));
const waiverFor = new Map(waivers.filter((w) => w.valid).map((w) => [w.ghsa, w]));
const used = new Set();

for (const advisory of blocking) {
  const id = advisory.github_advisory_id;
  const where = `${advisory.module_name} ${advisory.findings?.[0]?.version ?? ""}`.trim();
  const waiver = waiverFor.get(id);
  if (!waiver) {
    problems.push(
      `${advisory.severity}: ${id} in ${where} — ${advisory.title}\n      ` +
        `fixed in ${advisory.patched_versions}. ${advisory.url}`
    );
    continue;
  }
  used.add(id);
  if (waiver.remaining < 0) {
    problems.push(
      `${id} in ${where} was waived until ${waiver.expires}, ${-waiver.remaining} days ago, ` +
        `and is still here. ${advisory.url}`
    );
  } else {
    notes.push(`${id} (${where}) waived for another ${waiver.remaining} day(s): ${waiver.reason}`);
    if (waiver.remaining <= EXPIRING_SOON_DAYS) {
      notes.push(`  ^ lapses ${waiver.expires}; after that it blocks merges again.`);
    }
  }
}

for (const waiver of waivers) {
  if (!waiver.valid || used.has(waiver.ghsa)) continue;
  problems.push(
    `${ALLOWLIST} waives ${waiver.ghsa}, which no longer turns up in the audit. ` +
      `Delete the entry — the file is meant to describe what is wrong now.`
  );
}

if (notes.length > 0) {
  console.log(`Waived advisories:`);
  for (const note of notes) console.log(`  · ${note}`);
  console.log("");
}

if (problems.length > 0) {
  console.error(`High-severity advisories with no waiver, or waivers that have lapsed:\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error(
    `\nUpgrade the dependency, or add an override to pnpm-workspace.yaml if the fix ` +
      `is only reachable transitively. If neither is possible yet, add an entry to ` +
      `${ALLOWLIST} with the GHSA id, a reason, and an expiry date within ` +
      `${MAX_WAIVER_DAYS} days.`
  );
  process.exit(1);
}

const counts = advisories.reduce((tally, a) => tally.set(a.severity, (tally.get(a.severity) ?? 0) + 1), new Map());
const summary =
  counts.size === 0
    ? "no advisories at all"
    : [...counts].map(([severity, count]) => `${count} ${severity}`).join(", ");
console.log(`✓ Nothing at high severity or above is unaccounted for (${summary}).`);
