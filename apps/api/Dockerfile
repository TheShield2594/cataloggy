FROM node:26-alpine AS build

WORKDIR /app
RUN npm install -g corepack@latest && corepack enable
RUN apk add --no-cache openssl

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/addon/package.json ./apps/addon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/migrate/package.json ./packages/migrate/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

RUN pnpm exec prisma generate --schema=apps/api/prisma/schema.prisma
RUN pnpm --filter @cataloggy/shared build
RUN pnpm --filter @cataloggy/api build

# Two trees, because the Prisma CLI is only needed to apply migrations and is
# far larger than everything the service itself loads. @cataloggy/migrate
# depends on the CLI and nothing else, so this tree carries no test or build
# tooling; the schema and migrations it works on are the API's, copied in.
RUN pnpm deploy --filter @cataloggy/migrate --prod --legacy \
      --config.confirmModulesPurge=false /migrate \
 && cp -r apps/api/prisma apps/api/prisma.config.ts /migrate/

# The service tree: production dependencies only, so no CLI. `pnpm deploy`
# links a fresh @prisma/client from the store, so the client generated during
# the build has to come across separately — it lives in node_modules/.prisma,
# which @prisma/client re-exports.
RUN pnpm deploy --filter @cataloggy/api --prod --legacy \
      --config.confirmModulesPurge=false /deploy \
 && cp -r node_modules/.prisma /deploy/node_modules/.prisma

# Applies pending migrations and exits. Built as its own image (build target
# `migrate`) and run to completion before the service starts — see the `migrate`
# service in docker-compose.yml.
FROM node:26-alpine AS migrate

WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=build /migrate ./

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production

CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:26-alpine AS runtime

WORKDIR /app
RUN apk add --no-cache wget openssl

COPY --from=build /deploy ./

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production

EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7000/health || exit 1
CMD ["node", "dist/index.js"]
