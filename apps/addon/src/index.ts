import Fastify from "fastify";

const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`));

  return parsed.length > 0 ? parsed : [...fallback];
};

const CATALOGGY_API_BASE = process.env.CATALOGGY_API_BASE ?? "http://api:7000";
const CATALOGGY_API_TOKEN = process.env.CATALOGGY_API_TOKEN;
const ADDON_PUBLIC_BASE = process.env.ADDON_PUBLIC_BASE;
const PROXY_PATH_PREFIXES = parseProxyPathPrefixes(process.env.PROXY_PATH_PREFIXES, ["/addon"] as const);

const stripProxyPrefix = (url: string, prefix: string) => {
  if (url === prefix) {
    return "/";
  }

  if (!url.startsWith(`${prefix}/`)) {
    return null;
  }

  return url.slice(prefix.length) || "/";
};

const normalizeProxyPath = (rawUrl: string) => {
  for (const prefix of PROXY_PATH_PREFIXES) {
    const stripped = stripProxyPrefix(rawUrl, prefix);
    if (stripped) {
      return stripped;
    }
  }

  return rawUrl;
};

const app = Fastify({
  logger: true,
  rewriteUrl: (request) => normalizeProxyPath(request.url ?? "/")
});

type CataloggyList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom";
};

const manifest = {
  id: "com.cataloggy.personal",
  name: "Cataloggy (Personal)",
  version: "0.1.0",
  description: "Personal watchlist + continue watching from your self-hosted Cataloggy.",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [
    { type: "movie", id: "my_watchlist_movies", name: "Cataloggy Watchlist (Movies)" },
    { type: "series", id: "my_watchlist_series", name: "Cataloggy Watchlist (Shows)" },
    { type: "series", id: "my_continue_series", name: "Cataloggy Continue Watching" },
    { type: "movie", id: "my_recent_movies", name: "Cataloggy Recently Watched (Movies)" }
  ]
};

const catalogRouteMap: Record<string, string> = {
  "movie:my_watchlist_movies": "my_watchlist_movies",
  "series:my_watchlist_series": "my_watchlist_series",
  "series:my_continue_series": "my_continue_series",
  "movie:my_recent_movies": "my_recent_movies"
};

app.get("/health", async () => ({ status: "ok", service: "addon", publicBase: ADDON_PUBLIC_BASE ?? null }));

const fetchCustomLists = async (): Promise<CataloggyList[]> => {
  const apiUrl = new URL("/lists", CATALOGGY_API_BASE);
  const upstreamResponse = await fetch(apiUrl, {
    headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
  });

  if (!upstreamResponse.ok) {
    throw new Error(`Failed to fetch lists: ${upstreamResponse.status}`);
  }

  const payload = (await upstreamResponse.json()) as { lists?: CataloggyList[] };
  return (payload.lists ?? []).filter((list) => list.kind === "custom");
};

app.get("/manifest.json", async (request, reply) => {
  try {
    const customLists = await fetchCustomLists();
    const customCatalogs = customLists.flatMap((list) => [
      { type: "movie", id: `list_${list.id}_movies`, name: `Cataloggy List: ${list.name} (Movies)` },
      { type: "series", id: `list_${list.id}_series`, name: `Cataloggy List: ${list.name} (Shows)` }
    ]);

    return reply.send({
      ...manifest,
      catalogs: [...manifest.catalogs, ...customCatalogs]
    });
  } catch (error) {
    request.log.error(error, "Failed to fetch custom lists for manifest");
    return reply.code(502).send({ error: "Failed to build manifest" });
  }
});

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  const routeKey = `${request.params.type}:${request.params.id}`;
  const catalogId = catalogRouteMap[routeKey];

  if (!catalogId) {
    const customListMatch = request.params.id.match(/^list_([0-9a-f-]+)_(movies|series)$/i);
    if (!customListMatch) {
      return reply.code(404).send({ error: "Catalog not found" });
    }

    const listId = customListMatch[1];
    const listType = customListMatch[2] === "movies" ? "movie" : "series";

    if (request.params.type !== listType) {
      return reply.code(404).send({ error: "Catalog not found" });
    }

    const apiUrl = new URL(`/stremio/list/${encodeURIComponent(listId)}`, CATALOGGY_API_BASE);
    apiUrl.searchParams.set("type", listType);

    const upstreamResponse = await fetch(apiUrl, {
      headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
    });

    const payload = await upstreamResponse.json().catch(() => ({ metas: [] }));

    if (!upstreamResponse.ok) {
      return reply.code(upstreamResponse.status).send(payload);
    }

    return reply.send(payload);
  }

  const apiUrl = new URL(`/stremio/catalog/${catalogId}`, CATALOGGY_API_BASE);

  const upstreamResponse = await fetch(apiUrl, {
    headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
  });

  const payload = await upstreamResponse.json().catch(() => ({ metas: [] }));

  if (!upstreamResponse.ok) {
    return reply.code(upstreamResponse.status).send(payload);
  }

  return reply.send(payload);
});

app.get<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
  const { type, id } = request.params;

  if (type !== "movie" && type !== "series") {
    return reply.code(400).send({ error: "type must be one of: movie, series" });
  }

  const imdbId = id.trim();
  if (!imdbId) {
    return reply.code(400).send({ error: "id is required" });
  }

  const apiUrl = new URL(`/meta/${type}/${encodeURIComponent(imdbId)}`, CATALOGGY_API_BASE);

  const upstreamResponse = await fetch(apiUrl, {
    headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
  });

  const payload = await upstreamResponse.json().catch(() => ({}));

  if (!upstreamResponse.ok) {
    return reply.code(upstreamResponse.status).send(payload);
  }

  const releaseInfo = typeof payload.year === "number" ? String(payload.year) : undefined;

  return reply.send({
    meta: {
      id: imdbId,
      type,
      name: typeof payload.name === "string" && payload.name.trim() ? payload.name : imdbId,
      poster: typeof payload.poster === "string" ? payload.poster : undefined,
      background: typeof payload.background === "string" ? payload.background : undefined,
      description: typeof payload.description === "string" ? payload.description : undefined,
      releaseInfo,
      year: typeof payload.year === "number" ? payload.year : undefined
    }
  });
});

const start = async () => {
  const port = Number(process.env.PORT ?? 7001);
  await app.listen({ port, host: "0.0.0.0" });
};

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Shutting down addon service");

  try {
    await app.close();
    app.log.info("Addon service shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Error during addon shutdown");
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
