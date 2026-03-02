import Fastify from "fastify";

const app = Fastify({ logger: true });

const manifest = {
  id: "com.cataloggy.addon",
  version: "0.1.0",
  name: "CataLoggy",
  description: "Catalog and stream metadata addon for CataLoggy.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie",
      id: "cataloggy-movies",
      name: "CataLoggy Movies"
    }
  ]
};

app.get("/health", async () => ({ status: "ok", service: "addon" }));
app.get("/manifest.json", async () => manifest);

app.get<{ Params: { type: string; id: string } }>("/catalog/:type/:id.json", async (req) => ({
  metas: [],
  type: req.params.type,
  id: req.params.id
}));

app.get<{ Params: { type: string; id: string } }>("/meta/:type/:id.json", async (req) => ({
  meta: {
    id: req.params.id,
    type: req.params.type,
    name: "Placeholder",
    description: "Replace with real metadata source"
  }
}));

app.get<{ Params: { type: string; id: string } }>("/stream/:type/:id.json", async () => ({
  streams: []
}));

const start = async () => {
  const port = Number(process.env.PORT ?? 7001);
  await app.listen({ port, host: "0.0.0.0" });
};

start().catch((error) => {
  app.log.error(error);
  process.exit(1);
});
