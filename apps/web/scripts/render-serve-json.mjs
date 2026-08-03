#!/usr/bin/env node
// Renders dist/serve.json (the config `serve` reads for its response headers)
// from serve.template.json, filling in a `connect-src` scoped to the origins
// this container was actually configured to talk to.
//
// Run from docker-entrypoint.sh on every container start, alongside the
// dist/config.js write — both exist because VITE_* values are baked in at image
// build time, which is no use to a self-hoster configuring via .env.
import { readFileSync, writeFileSync } from "node:fs";
import { buildConnectSrc, renderServeConfig } from "./csp.mjs";

const [templatePath = "/app/serve.template.json", outputPath = "/app/dist/serve.json"] =
  process.argv.slice(2);

const connectSrc = buildConnectSrc({
  apiBase: process.env.VITE_API_BASE,
  addonBase: process.env.VITE_ADDON_BASE,
  sentryDsn: process.env.SENTRY_DSN,
  extra: process.env.CSP_CONNECT_SRC_EXTRA,
});

writeFileSync(outputPath, renderServeConfig(readFileSync(templatePath, "utf8"), connectSrc));

console.log(`Rendered ${outputPath} with connect-src ${connectSrc}`);
