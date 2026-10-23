# syntax=docker/dockerfile:1
# Production image: API + built web app in ONE container (same origin => no CORS, same-site cookie).
#   docker build -t supportdesk .
#   docker run --env-file server/.env.production.example ... (see docs/DEPLOYMENT.md)

# ---- 1. build the web app -------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
RUN npm ci
COPY client client
RUN npm run build -w client

# ---- 2. production-only dependencies for the API ---------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY server/prisma server/prisma
# `prisma generate` runs as a postinstall step; the Prisma CLI is a runtime dependency (migrate deploy).
RUN npm ci --omit=dev -w server \
    # npm keeps a package under server/node_modules when its version differs from one hoisted to the root,
    # so make sure that folder exists to be copied (it may legitimately be empty)
    && mkdir -p server/node_modules

# ---- 3. runtime ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 CLIENT_DIST=/app/client/dist UPLOAD_DIR=/data/uploads
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/uploads && chown -R node:node /data
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/server/node_modules ./server/node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node server/package.json server/
COPY --chown=node:node server/src server/src
COPY --chown=node:node server/prisma server/prisma
COPY --from=build --chown=node:node /app/client/dist client/dist
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER node
EXPOSE 4000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini = proper signal handling (graceful shutdown on SIGTERM) and zombie reaping
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
