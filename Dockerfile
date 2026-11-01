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
    AUTH_DEV_MODE=0
RUN pnpm build && rm -rf apps/web/.next/cache

FROM base AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.base.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web ./apps/web
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "/app/apps/web/node_modules/next/dist/bin/next", "start", "/app/apps/web"]

FROM base AS worker
RUN apk add --no-cache git docker-cli ca-certificates
ENV NODE_ENV=production
COPY --from=builder /app /app
WORKDIR /app/apps/web
CMD ["/app/node_modules/.bin/tsx", "scripts/job-worker.ts"]
