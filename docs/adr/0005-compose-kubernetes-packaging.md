# ADR 0005: Compose and Kubernetes packaging
- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT infrastructure

## Context
Spec §16/§17 needs a repeatable local stack and a production-shaped deployment.
The repo is an npm-workspaces monorepo with one NestJS/Fastify backend, two Vite
SPAs (web, dashboard), an Expo app that is not containerised here, and Postgres.
The environment used to verify this exposes only host ports 31000-31099, and
ad-hoc DinD containers cannot resolve Compose service names. Images must not
carry secrets, must run as non-root, and must be rebuildable from pinned bases.

## Options considered
- Bake a `.env` file into images: simple, but leaks secrets into layers and makes
  one image per environment. Rejected.
- Compose `profiles` for "core" vs "optional" services: profiles would hide
  postgres/backend from `up` by default and break `make dev-docker`. Rejected;
  all four services are core. An operator wanting an external database can use
  a Compose override that removes the `postgres` service and sets
  `DATABASE_URL`; this was not verified here.
- Mutable `latest` tags: rejected; rollback becomes ambiguous.
- Build SPAs at container start from source: slower and needs compilers in
  production. Rejected in favour of shipping built static assets.
- Run nginx as root on port 80: rejected; use a custom config on 8080 under
  uid/gid 101:101 with logs streamed to stdout/stderr.

## Decision
- `infrastructure/docker/compose.development.yaml` (`name: shat-dev`) bind-mounts
  source into Node dev images with an anonymous `/app/node_modules` volume.
  Backend dev runs `tsc --watch` plus `node --watch` because `@nestjs/cli` is
  not a dependency; ports are 31001:3000, 31002:5173, 31003:5173.
- `infrastructure/docker/compose.production.yaml` (`name: shat-prod`) has no bind
  mounts, uses `image:` keys `${SHAT_REGISTRY:-}shat-*:${SHAT_IMAGE_TAG:-2ae5e8f}`,
  `restart: unless-stopped`, healthchecks, and ports 31004:3000, 31005:8080,
  31006:8080. `SHAT_REGISTRY` is an optional registry namespace (include the
  trailing slash) so `make docker-push` has a target. `SHAT_IMAGE_TAG` must be a
  tag — for example an immutable commit SHA; a full digest after ':' is not a
  valid image reference and cannot be used here. Rollback is a redeploy with the
  previous tag. Immutability guaranteed here is tag-level, not digest-level.
- All images are multi-stage. Backend compiles TypeScript in a build stage and
  copies only pruned production dependencies and `dist` into a runtime stage
  with explicit UID/GID 10001, an exec-form `CMD`, a copied `package.json` so
  `"type": "module"` is explicit, `ATTACHMENT_STORAGE_DIR=/tmp/attachments`
  (the default `var/attachments` is root-owned), and a `node -e fetch` health
  check on `/health`. SPAs are built by Vite with `VITE_API_BASE_URL` as a build
  arg and served by pinned nginx:alpine as uid 101:101 with a `wget` healthcheck.
- Base images are pinned with tag **and** digest
  (`node:26.13.1-bookworm-slim@sha256:…`, `nginx:alpine@sha256:…`,
  `postgres:16-alpine@sha256:…`) and every postgres volume is named. The digest
  is the authoritative identifier. Tag-to-digest pairs were verified via the
  Docker Hub tag API on 2026-11-22; a stale postgres digest was corrected.
- Secrets are `${VAR:-}` environment substitutions with empty defaults: builds
  and `config` work offline, while runtime secret validation fails closed until
  the deploy environment supplies real values. No secret is in a layer.
- Kubernetes manifests stay a separate deployment surface (spec §17); this
  ADR fixes the image contract they must consume.

## Consequences
- Two Compose files duplicate service definitions; changes must be mirrored.
- Production SPAs bake `VITE_API_BASE_URL` at build time; a different API origin
  requires rebuilding the image with a new `VITE_API_BASE_URL` build arg.
- The default image tag is a commit SHA, not a digest; digest-level pinning
  requires changing the `image:` references themselves.
- Postgres is pinned to 16-alpine by digest; upgrades require an explicit ADR
  update and a database migration review.

### External database
To use an external database, add a Compose override that removes the `postgres`
service and sets `DATABASE_URL` to the external instance. This path is described
here only; it was not exercised in the verification environment.

## Evidence and sources
- Spec §14.1 (Compose/Kubernetes packaging ADR), §16, §17.
- Docker multi-stage, `.dockerignore`, non-root and Compose docs
  (docs.docker.com/llms.txt; build/ multi-stage and compose file reference).
- Files: `infrastructure/docker/{Dockerfile,Dockerfile.web,Dockerfile.dashboard,
  nginx.conf,compose.development.yaml,compose.production.yaml}`, `.dockerignore`.
- The pinned base-image tag↔digest pairs were verified via the Docker Hub tag
  API on 2026-11-22; re-check them before a real deploy because tags move.

## Revisit trigger
- A second backend instance or a shared metrics store is introduced.
- The team adopts Kubernetes as the primary local runtime instead of Compose.
- The pinned base digests or postgres major version need an upgrade.
