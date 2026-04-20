# syntax=docker/dockerfile:1.6
#
# OpenClaw Portal — single-image build.
# Stage 1: build frontend (static assets)
# Stage 2: build backend (TypeScript -> dist)
# Stage 3: slim runtime (only runtime deps + built artifacts)

ARG NODE_VERSION=22-alpine

# ---------- frontend ----------
FROM node:${NODE_VERSION} AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- backend ----------
FROM node:${NODE_VERSION} AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORTAL_PORT=18800 \
    GATEWAY_HOST=127.0.0.1 \
    GATEWAY_PORT=18789

COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 18800

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORTAL_PORT}/health || exit 1

CMD ["node", "backend/dist/index.js"]
