# syntax=docker/dockerfile:1
# SHAT backend. Pinned by digest: node:26.13.1-bookworm-slim.
ARG NODE_IMAGE=node:26.13.1-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1

# ---------------------------------------------------------------------------
# deps: one install of every workspace dependency (used by build and dev).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Only workspace manifests are needed to resolve the locked dependency graph;
# sources arrive in build/development, keeping this cache layer stable.
COPY apps/backend/package.json ./apps/backend/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/web/package.json ./apps/web/
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/database/package.json ./packages/database/
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# build: compile TypeScript to apps/backend/dist (rootDir is the repo root).
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build -w apps/backend

# ---------------------------------------------------------------------------
# prod-deps: start from the fully locked install, then prune to the backend's
# direct dependencies. Keeping node_modules/.package-lock.json (npm's hidden
# lockfile) preserves the resolved pins, and dropping the workspace
# package.json removes Expo and other app dependencies the backend never
# imports. The rewritten manifest has no devDependencies, so plain `npm prune`
# removes the extraneous dev packages as well; no --omit=dev is needed.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/backend/package.json /tmp/backend-package.json
RUN node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("/tmp/backend-package.json","utf8"));fs.writeFileSync("package.json",JSON.stringify({name:"shat-backend-runtime",version:"1.0.0",private:true,type:"module",dependencies:p.dependencies},null,2))' \
 && npm prune --no-audit --no-fund

# ---------------------------------------------------------------------------
# development: bind-mounted source in Compose; tsc --watch emits and node
# --watch restarts. @nestjs/cli is not a dependency, so no `nest start`.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS development
WORKDIR /app
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["sh", "-c", "npm run build -w apps/backend && (./node_modules/.bin/tsc -p apps/backend/tsconfig.json --watch --preserveWatchOutput & exec node --watch apps/backend/dist/apps/backend/src/main.js)"]

# ---------------------------------------------------------------------------
# runtime: production dependencies + compiled JS only, explicit non-root UID.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app/apps/backend
# Ciphertext blobs go to /var/lib/shat/attachments (uid 10001). The directory is
# created here and must be backed by a named volume in production Compose;
# /tmp would be discarded on recreate and the default var/attachments under
# /app/apps/backend is root-owned.
ENV NODE_ENV=production PORT=3000 ATTACHMENT_STORAGE_DIR=/var/lib/shat/attachments
RUN groupadd --gid 10001 shat \
 && useradd --uid 10001 --gid shat --shell /usr/sbin/nologin --no-create-home shat \
 && mkdir -p /var/lib/shat/attachments \
 && chown -R 10001:10001 /var/lib/shat
COPY --from=prod-deps --chown=10001:10001 /app/node_modules /app/node_modules
# The pruned manifest makes "type": "module" explicit for the compiled ESM entry.
COPY --from=prod-deps /app/package.json ./
COPY --from=build --chown=10001:10001 /app/apps/backend/dist ./dist
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
LABEL org.opencontainers.image.title="SHAT backend" \
      org.opencontainers.image.description="NestJS/Fastify API for SHAT" \
      org.opencontainers.image.source="https://github.com/rayenboussayed/shat" \
      org.opencontainers.image.vendor="SHAT" \
      org.opencontainers.image.licenses="UNLICENSED"
CMD ["node", "dist/apps/backend/src/main.js"]
