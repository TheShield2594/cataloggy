-- Add the enum value in its own migration so it is committed before use.
-- Postgres forbids using a new enum value in the same transaction that adds it,
-- and Prisma runs each migration file in a single transaction.
ALTER TYPE "ListKind" ADD VALUE 'collection';
