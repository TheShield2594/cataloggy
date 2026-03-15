const apiBase = process.env.API_BASE ?? "http://localhost:7000";
const addonBase = process.env.ADDON_BASE ?? "http://localhost:7001";
const apiToken = process.env.API_TOKEN ?? "dev-token";

const requiredTraktEnv = [
  "TRAKT_CLIENT_ID",
  "TRAKT_CLIENT_SECRET"
];

const check = async (name, run) => {
  process.stdout.write(`• ${name}... `);

  try {
    await run();
    process.stdout.write("ok\n");
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    process.stdout.write(`failed (${details})\n`);
    throw error;
  }
};

const getJson = async (url, init) => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }

  return { response, body };
};

await check("API /health", async () => {
  const { response, body } = await getJson(`${apiBase}/health`);
  if (!response.ok || body?.status !== "ok") {
    throw new Error(`Unexpected API /health response (${response.status}): ${JSON.stringify(body)}`);
  }
});

await check("Addon /manifest.json", async () => {
  const { response, body } = await getJson(`${addonBase}/manifest.json`);
  if (!response.ok || !Array.isArray(body?.catalogs)) {
    throw new Error(`Unexpected add-on manifest response (${response.status}): ${JSON.stringify(body)}`);
  }
});

const traktConfigured = requiredTraktEnv.every((key) => Boolean(process.env[key]));

if (traktConfigured) {
  await check("POST /trakt/import", async () => {
    const { response, body } = await getJson(`${apiBase}/trakt/import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`
      }
    });

    if (!response.ok) {
      throw new Error(`Trakt import failed (${response.status}): ${JSON.stringify(body)}`);
    }
  });

  await check("Catalog endpoint metas array", async () => {
    const { response, body } = await getJson(`${apiBase}/stremio/catalog/my_watchlist_movies`, {
      headers: {
        Authorization: `Bearer ${apiToken}`
      }
    });

    if (!response.ok || !Array.isArray(body?.metas)) {
      throw new Error(`Catalog endpoint invalid (${response.status}): ${JSON.stringify(body)}`);
    }
  });
} else {
  process.stdout.write("• Trakt env not fully set; skipping Trakt import checks.\n");
}

process.stdout.write("Smoke checks passed.\n");
