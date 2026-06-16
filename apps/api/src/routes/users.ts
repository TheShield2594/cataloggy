import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";

const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/users", async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });
    return { users };
  });

  app.post<{ Body: unknown }>("/users", async (request, reply) => {
    if (!request.body || typeof request.body !== "object") {
      return reply.code(400).send({ error: "email is required" });
    }

    const email = (request.body as { email?: unknown }).email;
    if (typeof email !== "string" || !email) {
      return reply.code(400).send({ error: "email is required" });
    }

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
