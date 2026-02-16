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

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/

# Data directory for persistent stores (mounted as volume)
RUN mkdir -p /data

ENV DATA_DIR=/data

ENTRYPOINT ["node", "dist/index.js"]
