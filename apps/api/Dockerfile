FROM node:20-alpine

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache wget

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/addon/package.json ./apps/addon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

RUN pnpm exec prisma generate --schema=apps/api/prisma/schema.prisma
RUN pnpm --filter @cataloggy/api build
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7000/health || exit 1
CMD ["pnpm", "--filter", "@cataloggy/api", "start"]
