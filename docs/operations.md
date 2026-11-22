# SHAT operations runbook

Spec v1.0-draft §16–§18. This is the deployment and recovery companion to
`README.md` (architecture) and ADR 0005 (packaging contract).

## Ports

| Surface | Local (native dev) | Docker dev | Docker prod |
| --- | --- | --- | --- |
| Backend HTTP / `/health` | 3000 | 31001:3000 | 31004:3000 |
| Web SPA | Vite default (5173) | 31002:5173 | 31005:8080 |
| Dashboard SPA | Vite default (5173) | 31003:5173 | 31006:8080 |
| PostgreSQL | 5432 | internal only | internal only |

Only host ports 31000–31099 are forwarded in the verification environment;
terminate TLS and map real public ports in the reverse proxy
(`infrastructure/docker/nginx.conf`).

## Environment

Copy `.env.example` to `.env`, generate every secret, and never commit `.env`.
Variables consumed by the apps:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend HTTP port, default 3000 |
| `DATABASE_URL` | PostgreSQL connection string; DB tests and backend require it |
| `CORS_ORIGINS` | Comma-separated allowed origins; empty denies all |
| `SHAT_ENROLLMENT_TOKEN`, `SHAT_ENROLLMENT_USER_ID` | Bootstrap enrollment; backend returns 503 until both are set |
| `TURN_SECRET`, `TURN_URIS` | TURN auth secret (>=32 chars, >=16 distinct) and client URIs |
| `SHAT_ADMIN_TOKEN` | Admin/telemetry token with the same strength rules |
| `EXPO_PUBLIC_API_BASE_URL`, `VITE_API_BASE_URL` | Mobile and web/dashboard API origins |
| `SHAT_OPENAPI` | Optional; set to `1` to enable OpenAPI generation in the backend |
| `ATTACHMENT_STORAGE_DIR` | Optional blob directory, default `var/attachments` |

Production Compose additionally reads `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `SHAT_REGISTRY` (registry namespace with trailing slash) and
`SHAT_IMAGE_TAG` (the immutable `sha-<commit>` tag pushed by the release
workflow). Empty secret values make the backend fail closed. No real secret is
baked into an image or a workflow; the smoke-test values are labelled dummy.

## Bootstrap and run

```bash
./scripts/bootstrap.sh                 # install, prerequisites, environment
cp .env.example .env                   # then fill in real generated values
make check                             # typecheck + lint + knip + tests
make db-up                             # start PostgreSQL (dev Compose)
npm run db:migrate                     # apply Drizzle migrations
make dev                               # native dev servers
make dev-docker                        # or the four-service dev stack
make compose-config                    # validate the dev Compose file; PR CI validates both
```

Production promotion requires the `production` GitHub environment to be
configured with required reviewers in repository settings; the release job
records approval but does not deploy to a remote host by itself.

Production:

```bash
SHAT_IMAGE_TAG=sha-<git-sha> SHAT_REGISTRY=<registry-ns/> \
  docker compose -f infrastructure/docker/compose.production.yaml up -d
make health                            # scripts/health-check.sh against /health
```

## Database and backups

- Migrations are generated with `make gen:migrations` and applied with
  `npm run db:migrate` (`make db-migrate`). `make db-reset` is destructive.
- Postgres data lives in named volumes `shat-postgres-dev` / `shat-postgres-prod`.
- Before any migration or deploy, take a logical backup, for example
  `docker compose -f infrastructure/docker/compose.production.yaml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql`. Verify the dump is
  non-empty and stored outside the volume. Restoring is `pg_dump`'s inverse with
  `psql`; rehearse it before relying on it.
- The pinned base-image tag↔digest correspondence was not verifiable in this
  environment (no registry reachability). Re-check digests before a real deploy;
  the current guarantee is immutable tag-level pinning, not digest-level.

## Rollback

1. Set `SHAT_IMAGE_TAG` to the previous known-good immutable tag and redeploy
   the production Compose stack (`up -d`); Compose replaces changed images.
   Never use a mutable `latest` tag as a rollback target.
2. Do **not** assume an automatic database rollback: schema changes are forward
   only. If a deploy changed the schema, restore the pre-deploy `pg_dump` into a
   stopped Postgres instance before starting the older app image.
3. Re-run `make health` and the smoke checks (backend `/health`, web and
   dashboard roots) and confirm the tag actually deployed.

## Native and E2EE caveats

Native mobile builds (Xcode/Android SDK), SQLCipher on device, Wi-Fi Direct /
Wi-Fi Aware, CallKit/PushKit/Core-Telecom, TURN interop with external peers and
end-to-end encryption are **not** verified here. EAS builds remain manual until
signing credentials and a macOS runner exist; CI must not report a green native
mobile build. See `apps/mobile/README.md`, ADR 0006 and `CHANGELOG.md`.
