FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api ./apps/api
COPY apps/addon ./apps/addon
COPY packages/shared ./packages/shared

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @cataloggy/api prisma generate

EXPOSE 7000
CMD ["sh", "-c", "pnpm --filter @cataloggy/api prisma db push && pnpm --filter @cataloggy/api start"]
