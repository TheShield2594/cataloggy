FROM node:26-alpine@sha256:233761595746769ebfdb6090f44fc7cdf818ae0ce62d2b37e0367723b9823e36 AS build

WORKDIR /app
RUN npm install -g corepack@latest && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/addon/package.json ./apps/addon/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/addon ./apps/addon
COPY packages/shared ./packages/shared

RUN pnpm --filter @cataloggy/shared build
RUN pnpm --filter @cataloggy/addon build

# Collect just this app into /deploy: its own production dependencies plus
# @cataloggy/shared, and nothing else. A workspace-wide `pnpm prune --prod`
# keeps the union of every project's production deps, so the addon image would
# otherwise carry the API's Prisma tree and the web app's React tree as well.
# `--legacy` selects the pre-v10 deploy that does not need injected workspace
# packages; `confirmModulesPurge` keeps pnpm from asking for a TTY it will
# never get inside a builder.
RUN pnpm deploy --filter @cataloggy/addon --prod --legacy \
      --config.confirmModulesPurge=false /deploy

FROM node:26-alpine@sha256:233761595746769ebfdb6090f44fc7cdf818ae0ce62d2b37e0367723b9823e36 AS runtime

WORKDIR /app
RUN apk add --no-cache wget
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /deploy ./

USER app
ENV NODE_ENV=production

EXPOSE 7001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7001/health || exit 1
CMD ["node", "dist/index.js"]
