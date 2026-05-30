# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────
# MIDSA Quote App — Backend container
#
# Standards anchor:
#   - ISO/IEC 27001:2022 A.8.32 (Change management — reproducible builds)
#   - ISO/IEC 27001:2022 A.8.5  (non-root runtime per principle of least privilege)
#   - CIS Docker Benchmark v1.6  (4.1 — run as non-root; 4.6 — HEALTHCHECK)
#   - 12-factor app §V (build/release/run separation)
#
# Multi-stage build:
#   Stage 1 (deps)    — install only production deps in an isolated layer
#                       for max Docker-layer cache reuse on dep churn.
#   Stage 2 (runtime) — minimal alpine image with the deps + code only.
#                       Never copies dev deps, .git, .env, or node_modules
#                       from the host (see .dockerignore).
#
# Run:
#   docker build -t midsa-backend:latest .
#   docker run -d --name midsa-backend \
#     -p 3001:3001 \
#     --env-file .env \
#     --restart unless-stopped \
#     midsa-backend:latest
# ─────────────────────────────────────────────────────────────────────────

# ── Stage 1: install production deps ────────────────────────────────────
FROM node:22-alpine AS deps

# tini = lightweight PID-1 init for Docker (reaps zombies, forwards SIGTERM
# correctly to Node so graceful shutdown works). Standard for Node + Alpine.
RUN apk add --no-cache tini

WORKDIR /app

# Copy ONLY the package files first so this layer caches when the app
# code changes but deps don't (the 90 % case during normal dev).
COPY package*.json ./

# Production install — no devDeps, no audit chatter, deterministic.
# `npm ci` (clean install) is faster than `npm install` and refuses to
# build if package.json and package-lock.json disagree — guaranteeing
# the lockfile is the source of truth.
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# ── Stage 2: runtime ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Same tini init as above
RUN apk add --no-cache tini

# CIS 4.1 — create + run as non-root user. UID 1001 picked because UID 1000
# is taken by the default `node` user on many node:alpine variants and we
# want a distinct identity for audit log correlation.
RUN addgroup -g 1001 -S midsa \
    && adduser  -u 1001 -S midsa -G midsa

WORKDIR /app

# Copy the prepared node_modules from the deps stage (not from host —
# host's node_modules may contain platform-specific binaries that won't
# work in Alpine).
COPY --chown=midsa:midsa --from=deps /app/node_modules ./node_modules

# Copy the application source. .dockerignore filters out .env, .git,
# tests, etc. Make sure the user owns everything so the process can
# read its own files at runtime.
COPY --chown=midsa:midsa . .

# Drop privileges. Everything below runs as midsa (UID 1001), not root.
USER midsa

ENV NODE_ENV=production \
    PORT=3001 \
    LOG_LEVEL=info

EXPOSE 3001

# CIS 4.6 — HEALTHCHECK directive so Docker / Compose / Swarm / K8s know
# the container is actually ready, not just running. Hits the deep probe
# so DB connectivity is part of the readiness signal.
#   --start-period: grace period during startup (waiting for DB pool init)
#   --interval:     run every 30s
#   --timeout:      probe fails if it takes > 5s
#   --retries:      mark unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider \
      "http://localhost:${PORT}/api/health?deep=1" \
      || exit 1

# tini handles SIGTERM/SIGINT correctly so Node's `closePool()` shutdown
# hook runs and the Oracle connections are released cleanly. Without
# tini, signals get swallowed by PID 1 semantics and the pool leaks.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
