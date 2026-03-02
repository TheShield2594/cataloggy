import Fastify from "fastify";

const app = Fastify({ logger: true });

const CATALOGGY_API_BASE = process.env.CATALOGGY_API_BASE ?? "http://api:7000";
const CATALOGGY_API_TOKEN = process.env.CATALOGGY_API_TOKEN;
const ADDON_PUBLIC_BASE = process.env.ADDON_PUBLIC_BASE;

const manifest = {
  id: "com.cataloggy.personal",
  name: "Cataloggy (Personal)",
  version: "0.1.0",
  description: "Personal watchlist + continue watching from your self-hosted Cataloggy.",
  resources: ["catalog"],
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
app.get("/manifest.json", async () => manifest);

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  const routeKey = `${request.params.type}:${request.params.id}`;
  const catalogId = catalogRouteMap[routeKey];

  if (!catalogId) {
    return reply.code(404).send({ error: "Catalog not found" });
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
