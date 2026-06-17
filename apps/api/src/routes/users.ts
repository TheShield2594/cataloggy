import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users", async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, createdAt: true },
    });
    return { users };
  });

  app.post<{ Body: unknown }>("/users", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "email is required" });
    }

    const rawEmail = (request.body as { email?: unknown }).email;
    if (typeof rawEmail !== "string" || !rawEmail.trim()) {
      return reply.code(400).send({ error: "email is required" });
    }
    const email = rawEmail.trim().toLowerCase();

    try {
      const user = await prisma.user.create({ data: { email } });
      return reply.code(201).send({ user });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ error: "Email already exists" });
      }
      throw error;
    }
  });
};

export default usersRoutes;
