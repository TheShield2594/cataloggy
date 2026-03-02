FROM node:20-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api ./apps/api
COPY apps/addon ./apps/addon
COPY packages/shared ./packages/shared

RUN pnpm install --frozen-lockfile=false

EXPOSE 7001
CMD ["pnpm", "--filter", "@cataloggy/addon", "start"]
