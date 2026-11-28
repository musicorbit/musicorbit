# Stage 1: Build shared package, API, and React web bundle
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Native build toolchain in case better-sqlite3 needs to compile from source
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace manifests first for better Docker layer caching
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci

# Copy source code and build all workspaces
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build

# Strip devDependencies so only runtime packages remain in node_modules
RUN npm prune --omit=dev

# Stage 2: Lean production runtime serving both API and built React SPA
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# Install ffmpeg so browser-incompatible lossless formats (ALAC/AIFF/WMA) transcode to lossless FLAC out of the box
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.source="https://github.com/musicorbit/musicorbit" \
      org.opencontainers.image.url="https://musicorbit.app" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4410 \
    MUSIC_DIR=/music \
    DATA_DIR=/data \
    DOWNLOADS_DIR=/downloads \
    WEB_DIST_DIR=/app/apps/web/dist \
    AUTH_ENABLED=true

# Create mount points owned by the non-root node user
RUN mkdir -p /music /data /downloads && chown -R node:node /music /data /downloads /app

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist

USER node

EXPOSE 4410

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4410) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
