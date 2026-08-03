FROM node:26-alpine AS build

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

RUN pnpm prune --prod --config.confirmModulesPurge=false

FROM node:26-alpine AS runtime

WORKDIR /app
RUN apk add --no-cache wget
RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/apps/addon/package.json ./apps/addon/package.json
COPY --from=build --chown=app:app /app/apps/addon/node_modules ./apps/addon/node_modules
COPY --from=build --chown=app:app /app/apps/addon/dist ./apps/addon/dist
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist

USER app
ENV NODE_ENV=production

EXPOSE 7001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7001/health || exit 1
CMD ["node", "apps/addon/dist/index.js"]
