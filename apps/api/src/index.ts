import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "api" }));

app.get("/users", async () => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  return { users };
});

app.post<{ Body: { email: string } }>("/users", async (request, reply) => {
  const { email } = request.body;

  if (!email) {
    return reply.code(400).send({ error: "email is required" });
  }

  const user = await prisma.user.create({ data: { email } });
  return reply.code(201).send({ user });
});

const start = async () => {
  const port = Number(process.env.PORT ?? 7000);
  await app.listen({ port, host: "0.0.0.0" });
};

start().catch(async (error) => {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
