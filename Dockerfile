# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────
# MIDSA Quote App — Frontend container (Vite build → nginx serve)
#
# Standards anchor:
#   - ISO/IEC 27001:2022 A.8.32 (Change management — reproducible builds)
#   - ISO/IEC 27001:2022 A.8.5  (least-privilege runtime)
#   - CIS Docker Benchmark v1.6
#   - 12-factor app §V (build/release/run separation)
#
# Three-stage build:
#   Stage 1 (deps)   — install dev + prod deps for Vite build
#   Stage 2 (build)  — run `npm run build` → produces dist/
#   Stage 3 (runtime) — nginx:alpine serving dist/ static files,
#                       with a reverse-proxy block forwarding /api/*
#                       to the backend container (set via env var).
#
# Build + run:
#   docker build -t midsa-frontend:latest .
#   docker run -d --name midsa-frontend \
#     -p 8080:80 \
#     -e API_BACKEND=http://midsa-backend:3001 \
#     --restart unless-stopped \
#     midsa-frontend:latest
# ─────────────────────────────────────────────────────────────────────────

# ── Stage 1: deps ───────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# ── Stage 2: build ──────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Reuse the cached node_modules from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Now copy the rest of the source. .dockerignore filters out node_modules
# (from host), .env, .git, backend/, etc.
COPY . .

# Vite production build → dist/
# Set NODE_ENV=production so any conditional dev-only code is dropped.
ENV NODE_ENV=production
RUN npm run build

# ── Stage 3: runtime (nginx) ────────────────────────────────────────────
FROM nginx:alpine AS runtime

# Replace the default nginx config with our reverse-proxy + SPA-fallback
# block (see nginx.conf in repo root).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the Vite build artefact. nginx serves it as static files.
COPY --from=build /app/dist /usr/share/nginx/html

# CIS 4.1 — drop privileges. nginx:alpine ships an `nginx` user (UID 101).
# The official nginx image already runs the worker processes as `nginx`;
# we explicitly set USER too for defence in depth.
USER nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1
