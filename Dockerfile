FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
ENV NODE_ENV=production \
    AUTH_SECRET=build-only-placeholder-not-used-at-runtime \
    AUTH_DEV_MODE=0 \
    NEXT_OUTPUT=standalone
RUN pnpm build && rm -rf apps/web/.next/cache

# 只保留 standalone 产物：61MB 左右，不再带 devDependencies 和源码。
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# worker 只依赖 packages/core 和 apps/worker，不再需要 apps/web 的源码与 Next。
FROM base AS worker
RUN apk add --no-cache git docker-cli ca-certificates
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
# 只用于满足 lockfile 校验；apps/web 的依赖仍会被装进来，后面删掉 Next。
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --config.node-linker=hoisted \
 && rm -rf /app/node_modules/next /app/node_modules/react /app/node_modules/react-dom \
           /app/node_modules/@next /app/node_modules/.bin/next
WORKDIR /app/apps/worker
CMD ["/app/node_modules/.bin/tsx", "src/worker.ts"]
