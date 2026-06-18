FROM node:20-alpine AS build

WORKDIR /app
RUN corepack enable
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

RUN pnpm prune --prod

FROM node:20-alpine AS runtime

WORKDIR /app
RUN corepack enable
RUN apk add --no-cache wget openssl

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV NODE_ENV=production

EXPOSE 7000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7000/health || exit 1
CMD ["sh", "-c", "pnpm exec prisma migrate deploy --schema=apps/api/prisma/schema.prisma && node apps/api/dist/index.js"]
