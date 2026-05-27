# ── Build frontend ──
FROM node:22-alpine AS frontend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/backend/package.json packages/backend/package.json

RUN pnpm install --frozen-lockfile

COPY packages/frontend/ packages/frontend/
RUN pnpm --filter @panelshelf/frontend run build

# ── Build backend ──
FROM node:22-alpine AS backend-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/backend/package.json packages/backend/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/backend/ packages/backend/
RUN pnpm --filter @panelshelf/backend run build

# ── Runtime ──
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY --from=backend-builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-builder /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=backend-builder /app/packages/backend/src/db/migrations ./packages/backend/dist/db/migrations
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist
COPY package.json pnpm-workspace.yaml ./

# Install production deps only
COPY pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV DOWNLOAD_DIR=/downloads

VOLUME ["/data", "/downloads"]

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/backend/dist/index.js"]
