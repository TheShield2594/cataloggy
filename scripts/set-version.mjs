#!/usr/bin/env node
// Sets the version on every package.json in the workspace at once.
//
// There are six of them, and nothing links them: bumping by hand means six
// edits that have to agree, and the one that gets missed is invisible until
// someone reads it in a bug report. `pnpm version` won't do it either — it
// operates on one package, and these are private workspace packages that are
// never published to a registry, so their versions exist purely to answer
// "which build is this".
//
// Run with `pnpm version:set 0.2.0`, or `--check` to assert they already agree.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const MANIFESTS = [
  "package.json",
  "apps/api/package.json",
  "apps/addon/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
  "packages/migrate/package.json",
];

// Plain `major.minor.patch`. Pre-release and build metadata are deliberately
// unsupported: `CATALOGGY_IMAGE_TAG` is what a self-hoster types into a `.env`,
// and a tag with a `+` in it is not a valid Docker tag.
const SEMVER = /^\d+\.\d+\.\d+$/;

const read = (relPath) => {
  const path = join(repoRoot, relPath);
  return { path, raw: readFileSync(path, "utf8") };
};

const versionOf = (raw) => JSON.parse(raw).version;

const check = () => {
  const versions = MANIFESTS.map((relPath) => {
    const { raw } = read(relPath);
    return { relPath, version: versionOf(raw) };
  });

  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length === 1) {
    console.log(`All ${versions.length} manifests are at ${distinct[0]}.`);
    return 0;
  }

  console.error("Workspace versions disagree:");
  for (const { relPath, version } of versions) console.error(`  ${version}\t${relPath}`);
  return 1;
};

const setVersion = (version) => {
  if (!SEMVER.test(version)) {
    console.error(`"${version}" is not a major.minor.patch version.`);
    return 1;
  }

  for (const relPath of MANIFESTS) {
    const { path, raw } = read(relPath);
    // A targeted replacement of the `version` line rather than a
    // parse-and-stringify round trip, which would reformat the whole file and
    // drop key order for the sake of one field.
    const updated = raw.replace(/^(\s*)"version":\s*"[^"]*"/m, `$1"version": "${version}"`);
    if (updated === raw && versionOf(raw) !== version) {
      console.error(`Could not find a version field in ${relPath}.`);
      return 1;
    }
    writeFileSync(path, updated);
    console.log(`${relative(repoRoot, path)} → ${version}`);
  }

  console.log(`\nNext: update CHANGELOG.md, commit, then tag v${version}.`);
  return 0;
};

const [arg] = process.argv.slice(2);
if (!arg) {
  console.error("Usage: pnpm version:set <major.minor.patch> | --check");
  process.exit(1);
}

process.exit(arg === "--check" ? check() : setVersion(arg));
