FROM node:26-alpine@sha256:233761595746769ebfdb6090f44fc7cdf818ae0ce62d2b37e0367723b9823e36 AS build

WORKDIR /app
RUN npm install -g corepack@latest && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs .npmrc ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY apps/addon/package.json ./apps/addon/package.json

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web

RUN pnpm --filter @cataloggy/web build

FROM node:26-alpine@sha256:233761595746769ebfdb6090f44fc7cdf818ae0ce62d2b37e0367723b9823e36 AS runtime

WORKDIR /app
RUN apk add --no-cache wget && npm install -g serve@14

COPY --from=build /app/apps/web/dist ./dist
# dist/serve.json is rendered from this template at container start — it carries
# a connect-src that depends on runtime env, so it cannot be baked in here.
COPY apps/web/serve.template.json ./serve.template.json
COPY apps/web/scripts/csp.mjs apps/web/scripts/render-serve-json.mjs ./scripts/
# csp.mjs reads the artwork-CDN list from here — the same list the service
# worker in dist/ was built against, so `connect-src` cannot fall behind what
# the worker fetches. Keep the path: the import is relative to scripts/.
COPY apps/web/src/image-cdn-hosts.mjs ./src/image-cdn-hosts.mjs
COPY apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 7002
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD wget -q --spider http://127.0.0.1:7002/ || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["serve", "-s", "dist", "-l", "7002"]
