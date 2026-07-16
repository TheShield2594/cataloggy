FROM node:26-alpine

WORKDIR /app
RUN npm install -g corepack@latest && corepack enable
RUN apk add --no-cache wget

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/addon/package.json ./apps/addon/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY apps/addon ./apps/addon
COPY packages/shared ./packages/shared

RUN pnpm --filter @cataloggy/shared build
RUN cd apps/addon && pnpm exec tsc -p tsconfig.json
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
ENV NODE_ENV=production

EXPOSE 7001
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7001/health || exit 1
CMD ["pnpm", "--filter", "@cataloggy/addon", "start"]
