import { Prisma } from "@prisma/client";

export const P2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
  code: "P2002",
  clientVersion: "test",
});
