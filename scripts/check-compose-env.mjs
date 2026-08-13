#!/usr/bin/env node
// Every environment variable the app code reads has to be handed to the
// container that reads it. Compose substitutes `.env` into docker-compose.yml
// itself — it does not forward the file's contents into containers — so a
// variable that is documented in `.env.example` but absent from the relevant
// service's `environment:` block reaches nothing, silently, and the feature it
// controls just never turns on.
//
// That is how eight variables (WEBHOOK_SECRET and WEBHOOK_ALLOWED_IPS among
// them, so the Plex/Jellyfin webhooks were unreachable on the documented
// install path) went missing for as long as they did: nothing compares the two
// sides. This does. For each source tree it collects every `process.env.NAME`
// and asserts the name appears in the `environment:` block of each compose
// service that runs that code.
//
// Run with `pnpm check:env`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPOSE_FILE = "docker-compose.yml";

// Which compose service runs each app's code.
const APP_SERVICES = {
  "apps/api": "api",
  "apps/addon": "addon",
  "apps/web": "web",
};

// Packages that ship as a service of their own rather than as a dependency of
// an app. Everything else under packages/ is mapped to the services of the apps
// that depend on it, read from the workspace graph below — hardcoding that list
// would be the same kind of drift this script exists to catch.
const PACKAGE_SERVICES = {
  "packages/migrate": ["migrate"],
};

// Names that are legitimately absent from the compose file. Each needs a reason
// — "it's fine" is how the next one slips through.
const EXEMPT = new Map([
  ["NODE_ENV", "set by every app's Dockerfile (ENV NODE_ENV=production)"],
  [
    "WEB_PUBLIC_BASE",
    "legacy alias read only as a fallback for CATALOGGY_WEB_PUBLIC, which compose does set",
  ],
]);

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".turbo"]);
// Tests set process.env themselves; they are not deployment configuration.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|test)(\/|$)/;

const ENV_READ = /process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s*\])/g;

// A focused reader for the one shape this file uses, rather than a YAML
// dependency: two-space-indented service names under `services:`, and either a
// `KEY: value` map or a `- KEY=value` list under `environment:`.
const parseComposeEnvironments = (source) => {
  const services = new Map();
  let inServices = false;
  let service = null;
  let inEnvironment = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line || /^\s*#/.test(line)) continue;

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      inServices = /^services:\s*$/.test(line);
      service = null;
      inEnvironment = false;
      continue;
    }

    if (!inServices) continue;

    if (indent === 2) {
      const match = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
      service = match ? match[1] : null;
      if (service) services.set(service, new Set());
      inEnvironment = false;
      continue;
    }

    if (!service) continue;

    if (indent === 4) {
      inEnvironment = /^ {4}environment:\s*$/.test(line);
      continue;
    }

    if (!inEnvironment || indent < 6) continue;

    const mapEntry = /^\s*([A-Za-z_][A-Za-z0-9_]*):/.exec(line);
    const listEntry = /^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]?/.exec(line);
    const key = mapEntry?.[1] ?? listEntry?.[1];
    if (key) services.get(service).add(key);
  }

  return services;
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, files);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      files.push(path);
    }
  }
  return files;
};

// name -> [{ file, line }]
const collectEnvReads = (dir) => {
  const reads = new Map();

  for (const file of walk(dir)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (TEST_FILE.test(rel) || TEST_DIR.test(rel)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const match of text.matchAll(ENV_READ)) {
        const name = match[1] ?? match[2];
        if (!reads.has(name)) reads.set(name, []);
        reads.get(name).push({ file: rel, line: index + 1 });
      }
    });
  }

  return reads;
};

const readPackageJson = (dir) => JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8"));

// packages/<name> -> the services of every app that depends on it, so a
// variable read from a shared package is required on each of them.
const resolveSourceTrees = () => {
  const trees = Object.entries(APP_SERVICES).map(([dir, service]) => ({ dir, services: [service] }));

  const packageDirs = readdirSync(join(ROOT, "packages"))
    .map((name) => `packages/${name}`)
    .filter((dir) => existsSync(join(ROOT, dir, "package.json")));
  const nameToDir = new Map(packageDirs.map((dir) => [readPackageJson(dir).name, dir]));
  const dependents = new Map(packageDirs.map((dir) => [dir, new Set()]));

  for (const [appDir, service] of Object.entries(APP_SERVICES)) {
    const manifest = readPackageJson(appDir);
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const name of Object.keys(deps)) {
      const dir = nameToDir.get(name);
      if (dir) dependents.get(dir).add(service);
    }
  }

  for (const dir of packageDirs) {
    const services = PACKAGE_SERVICES[dir] ?? [...dependents.get(dir)];
    if (services.length > 0) trees.push({ dir, services });
  }

  return trees;
};

const composeSource = readFileSync(join(ROOT, COMPOSE_FILE), "utf8");
const composeServices = parseComposeEnvironments(composeSource);

const sourceTrees = resolveSourceTrees();
const problems = [];

for (const { dir, services } of sourceTrees) {
  const absolute = join(ROOT, dir);
  let exists = true;
  try {
    exists = statSync(absolute).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) {
    problems.push(
      `${dir} is mapped to a compose service but does not exist — update ${relative(ROOT, fileURLToPath(import.meta.url))}.`
    );
    continue;
  }

  for (const service of services) {
    if (!composeServices.has(service)) {
      problems.push(`${COMPOSE_FILE} has no service named "${service}", which ${dir} is mapped to.`);
    }
  }

  const reads = collectEnvReads(absolute);

  for (const [name, sites] of [...reads].sort(([a], [b]) => a.localeCompare(b))) {
    if (EXEMPT.has(name)) continue;

    const missingFrom = services.filter(
      (service) => composeServices.has(service) && !composeServices.get(service).has(name)
    );
    if (missingFrom.length === 0) continue;

    const where = sites
      .slice(0, 3)
      .map((site) => `${site.file}:${site.line}`)
      .join(", ");
    const more = sites.length > 3 ? `, +${sites.length - 3} more` : "";
    const named = missingFrom.map((service) => `"${service}"`).join(" / ");
    const owner = missingFrom.length > 1 ? `${named} services'` : `${named} service's`;
    problems.push(
      `${name} is read at ${where}${more} but is not in the ${owner} ` +
        `environment: block in ${COMPOSE_FILE}.`
    );
  }
}

if (problems.length > 0) {
  console.error(`Environment variables read by the app but never passed into its container:\n`);
  for (const problem of problems) console.error(`  ✖ ${problem}`);
  console.error(
    `\nAdd each one to the named service's environment: block using the ` +
      `\${VAR:-default} form, or — if it genuinely comes from somewhere else — ` +
      `add it to EXEMPT in scripts/check-compose-env.mjs with the reason.`
  );
  process.exit(1);
}

const checked = [...new Set(sourceTrees.flatMap((tree) => tree.services))].sort().join(", ");
console.log(`✓ Every process.env read reaches its container (services checked: ${checked}).`);
