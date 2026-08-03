FROM node:26-alpine AS build

WORKDIR /app
RUN npm install -g corepack@latest && corepack enable
RUN apk add --no-cache openssl

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/addon/package.json ./apps/addon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

RUN pnpm exec prisma generate --schema=apps/api/prisma/schema.prisma
RUN pnpm --filter @cataloggy/shared build
RUN pnpm --filter @cataloggy/api build

# Collect just this app into /deploy: its own production dependencies plus
# @cataloggy/shared, and nothing else. A workspace-wide `pnpm prune --prod`
# keeps the union of every project's production deps, so the API image would
# otherwise carry the web app's React/Sentry/workbox tree as well.
# `--legacy` selects the pre-v10 deploy that does not need injected workspace
# packages; `confirmModulesPurge` keeps pnpm from asking for a TTY it will
# never get inside a builder.
RUN pnpm deploy --filter @cataloggy/api --prod --legacy \
      --config.confirmModulesPurge=false /deploy

# /deploy links a fresh @prisma/client from the store, so the client generated
# during the build above is not the one that ships. Generate it again in place.
RUN cd /deploy && ./node_modules/.bin/prisma generate

FROM node:26-alpine AS runtime

WORKDIR /app
RUN apk add --no-cache wget openssl

COPY --from=build /deploy ./

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production

EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7000/health || exit 1
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/index.js"]
