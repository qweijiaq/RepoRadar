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

# worker 要跑 TS 源码和沙箱验证，只装生产依赖，不带 Next 构建产物和开发工具。
# 直接用构建上下文里的源码，和 builder 阶段互不依赖。
FROM base AS worker
RUN apk add --no-cache git docker-cli ca-certificates
ENV NODE_ENV=production
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# migrate 服务用同一个 target 跑 apps/worker/src/cli.ts，必须一起带上。
COPY apps/worker ./apps/worker
# 双保险：构建上下文里可能残留 .next，worker 不需要。
RUN rm -rf /app/apps/web/.next /app/apps/web/.next-e2e
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --config.node-linker=hoisted
WORKDIR /app/apps/web
CMD ["/app/node_modules/.bin/tsx", "scripts/job-worker.ts"]
