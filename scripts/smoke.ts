const apiBase = process.env.API_BASE ?? "http://localhost:7000";
const addonBase = process.env.ADDON_BASE ?? "http://localhost:7001";
const apiToken = process.env.API_TOKEN ?? "dev-token";

let failed = false;

const check = async (name: string, run: () => Promise<void>): Promise<void> => {
  process.stdout.write(`• ${name}... `);
  try {
    await run();
    process.stdout.write("PASS\n");
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    process.stdout.write(`FAIL (${details})\n`);
    failed = true;
  }
};

const getJson = async (url: string, init?: RequestInit): Promise<{ response: Response; body: unknown }> => {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { response, body };
};

// 1. GET /health on API — expect 200
await check("API /health", async () => {
  const { response, body } = await getJson(`${apiBase}/health`);
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  if ((body as Record<string, unknown>)?.status !== "ok") {
    throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
  }
});

// 2. GET /manifest.json on addon — expect 200 with valid JSON containing a catalogs array
type Manifest = { catalogs?: Array<{ type: string; id: string; name: string }> };
let manifest: Manifest | null = null;

await check("Addon /manifest.json", async () => {
  const { response, body } = await getJson(`${addonBase}/manifest.json`);
  if (response.status !== 200) {
    throw new Error(`Expected 200, got ${response.status}`);
  }
  const m = body as Manifest;
  if (!Array.isArray(m?.catalogs)) {
    throw new Error(`Response missing catalogs array: ${JSON.stringify(body)}`);
  }
  manifest = m;
});

// 3. If TRAKT_CLIENT_ID is set, POST /trakt/import — expect 200 with { imported: { movies, episodes } }
if (process.env.TRAKT_CLIENT_ID) {
  await check("POST /trakt/import", async () => {
    const { response, body } = await getJson(`${apiBase}/trakt/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }
    const b = body as { imported?: { movies?: unknown; episodes?: unknown } };
    if (!b?.imported || !("movies" in b.imported) || !("episodes" in b.imported)) {
      throw new Error(`Expected { imported: { movies, episodes } }, got: ${JSON.stringify(body)}`);
    }
  });

  // 4. GET /catalog/movie/{first catalog id}.json — expect { metas: [...] }
  const firstMovieCatalog = manifest?.catalogs?.find((c) => c.type === "movie");
  if (firstMovieCatalog) {
    await check(`Catalog /catalog/movie/${firstMovieCatalog.id}.json`, async () => {
      const { response, body } = await getJson(`${addonBase}/catalog/movie/${firstMovieCatalog.id}.json`);
      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }
      const b = body as { metas?: unknown[] };
      if (!Array.isArray(b?.metas)) {
        throw new Error(`Expected { metas: [...] }, got: ${JSON.stringify(body)}`);
      }
    });
  } else {
    process.stdout.write("• Catalog movie check... SKIP (no movie catalog in manifest)\n");
  }
} else {
  process.stdout.write("• Trakt checks... SKIP (TRAKT_CLIENT_ID not set)\n");
}

if (failed) {
  process.stdout.write("\nSome smoke checks failed.\n");
  process.exit(1);
} else {
  process.stdout.write("\nAll smoke checks passed.\n");
}
