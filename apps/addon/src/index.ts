import Fastify, { type FastifyRequest, type FastifyReply, type RawRequestDefaultExpression } from "fastify";

const parseProxyPathPrefixes = (raw: string | undefined, fallback: readonly string[]) => {
  const parsed = (raw ?? "")
    .split(",")
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .map((prefix) => (prefix.startsWith("/") ? prefix : `/${prefix}`))
    .map((prefix) => (prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix));

  return parsed.length > 0 ? parsed : [...fallback];
};

const CATALOGGY_API_BASE = process.env.CATALOGGY_API ?? process.env.CATALOGGY_API_BASE ?? "http://api:7000";
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
  rewriteUrl: (request: RawRequestDefaultExpression) => normalizeProxyPath(request.url ?? "/")
});

type CataloggyList = {
  id: string;
  name: string;
  kind: "watchlist" | "custom";
};

let cachedManifest: { data: object; expiry: number } | null = null;
const MANIFEST_CACHE_TTL_MS = 60_000;

app.get("/health", async () => ({ status: "ok", service: "addon", publicBase: ADDON_PUBLIC_BASE ?? null }));

const fetchAllLists = async (): Promise<CataloggyList[]> => {
  const apiUrl = new URL("/lists", CATALOGGY_API_BASE);
  const upstreamResponse = await fetch(apiUrl, {
    headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
  });

  if (!upstreamResponse.ok) {
    throw new Error(`Failed to fetch lists: ${upstreamResponse.status}`);
  }

  const payload = (await upstreamResponse.json()) as { lists?: CataloggyList[] };
  return payload.lists ?? [];
};

const buildManifest = (lists: CataloggyList[]) => {
  const catalogs = lists.flatMap((list) => [
    { type: "movie" as const, id: `cataloggy-${list.id}-movie`, name: list.name, extra: [{ name: "search", isRequired: false }] },
    { type: "series" as const, id: `cataloggy-${list.id}-series`, name: list.name, extra: [{ name: "search", isRequired: false }] }
  ]);

  return {
    id: "com.cataloggy.addon",
    version: "0.1.0",
    name: "CataLoggy",
    description: "Personal catalogs powered by CataLoggy.",
    resources: ["catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs
  };
};

app.get("/manifest.json", async (request: FastifyRequest, reply: FastifyReply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const now = Date.now();
  if (cachedManifest && now < cachedManifest.expiry) {
    return reply.send(cachedManifest.data);
  }

  try {
    const lists = await fetchAllLists();
    const data = buildManifest(lists);
    cachedManifest = { data, expiry: now + MANIFEST_CACHE_TTL_MS };
    return reply.send(data);
  } catch (error) {
    request.log.error(error, "Failed to fetch lists for manifest");
    return reply.code(502).send({ error: "Failed to build manifest" });
  }
});

type ListItemResponse = {
  imdbId: string;
  type: string;
  metadata: { name: string; poster: string | null; year: number | null } | null;
};

type StremioMetaPreview = {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape: "poster";
};

const parseCatalogId = (id: string) => {
  const match = id.match(/^cataloggy-([0-9a-f-]+)-(movie|series)$/i);
  if (!match) return null;
  return { listId: match[1], catalogType: match[2] };
};

const fetchListItems = async (listId: string): Promise<ListItemResponse[]> => {
  const apiUrl = new URL(`/lists/${encodeURIComponent(listId)}/items`, CATALOGGY_API_BASE);
  const response = await fetch(apiUrl, {
    headers: CATALOGGY_API_TOKEN ? { Authorization: `Bearer ${CATALOGGY_API_TOKEN}` } : {}
  });

  if (!response.ok) {
    throw new Error(`API responded with ${response.status}`);
  }

  const payload = (await response.json()) as { items?: ListItemResponse[] };
  return payload.items ?? [];
};

const itemsToMetas = (items: ListItemResponse[], type: string): StremioMetaPreview[] =>
  items
    .filter((item) => item.type === type)
    .map((item) => ({
      id: item.imdbId,
      type: item.type,
      name: item.metadata?.name ?? item.imdbId,
      ...(item.metadata?.poster ? { poster: item.metadata.poster } : {}),
      posterShape: "poster" as const
    }));

const parseExtra = (extra: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const pair of extra.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
    }
  }
  return params;
};

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id } = request.params;
  const parsed = parseCatalogId(id);

  if (!parsed || type !== parsed.catalogType) {
    return reply.code(200).send({ metas: [] });
  }

  try {
    const items = await fetchListItems(parsed.listId);
    const metas = itemsToMetas(items, type);
    return reply.send({ metas });
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

app.get<{ Params: { type: string; id: string; extra: string } }>("/catalog/:type/:id/:extra.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Content-Type", "application/json");

  const { type, id, extra } = request.params;
  const parsed = parseCatalogId(id);

  if (!parsed || type !== parsed.catalogType) {
    return reply.send({ metas: [] });
  }

  try {
    const items = await fetchListItems(parsed.listId);
    let metas = itemsToMetas(items, type);

    const extraParams = parseExtra(extra);
    if (extraParams.search) {
      const query = extraParams.search.toLowerCase();
      metas = metas.filter((m) => m.name.toLowerCase().includes(query));
    }

    return reply.send({ metas });
  } catch (error) {
    request.log.error(error, "Failed to fetch catalog items");
    return reply.send({ metas: [] });
  }
});

app.get<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
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
