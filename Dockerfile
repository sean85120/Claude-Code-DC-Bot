# ── Stage 1: Build ──────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Create non-root user for defense-in-depth
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/

# Data directory for persistent stores (mounted as volume)
RUN mkdir -p /data && chown botuser:botgroup /data

ENV DATA_DIR=/data

USER botuser

ENTRYPOINT ["node", "dist/index.js"]
