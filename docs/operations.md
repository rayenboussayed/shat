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
| `ATTACHMENT_STORAGE_DIR` | Optional blob directory; `var/attachments` locally, `/var/lib/shat/attachments` in the production image (named volume) |
| `ATTACHMENT_CAPABILITY_KEY` | Optional base64 key (>=32 bytes decoded) that signs download capabilities; when unset a random per-process key is used, so tokens die on restart |

Production Compose additionally reads `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB`, `SHAT_REGISTRY` (registry namespace with trailing slash) and
`SHAT_IMAGE_TAG` (the immutable `sha-<commit>` tag pushed by the release
workflow). Empty secret values make the backend fail closed. No real secret is
baked into an image or a workflow; the smoke-test values are labelled dummy.

### Secret handling limitation

The backend reads `SHAT_ENROLLMENT_TOKEN`, `SHAT_ADMIN_TOKEN` and `TURN_SECRET`
directly from `process.env` (see `apps/backend/src/admin/admin.config.ts` and
`apps/backend/src/turn/turn.config.ts`); it has no `*_FILE` support. A Compose
`secrets:` file mount under `/run/secrets` therefore cannot be consumed by the
app without a code change, which this scope does not make. Production Compose
keeps environment injection and the deploy environment **must source these
values from a secret manager** (for example a Vault Agent or cloud secret
sidecar that populates the process environment). Compose `secrets:` are not
used here because they would only add an unreadable file. Never place a real
secret in `.env`, an image layer or this repository; rotate any value that
leaks into a shell history or CI log.

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

## Release

Releases use GitHub only. Push an annotated, signed `v*` tag to trigger
`.github/workflows/release.yml`. The workflow publishes `shat-backend`,
`shat-web` and `shat-dashboard` to GHCR with an immutable `sha-<commit>` tag and
no `latest`. No Play Store or App Store submission is made, no AAB is built, and
no GitHub Release object is created because there is no gh token here. iOS cannot
be built on Linux, so no iOS artifact is produced. The mobile Maestro flows are
authored and statically reviewed but not executed locally.

To verify a release locally, build first, then run the e2e suites:

```bash
npm run build              # required: backend e2e and Playwright both start dist/apps/backend/src/main.js
npm run test-e2e           # backend typed API contract (vitest e2e)
npm run test-e2e:browser   # Playwright web + dashboard specs in Chromium
```

Chromium cannot launch in this build container because `libnspr4.so` is missing
and the apt lists are not writable, so the browser specs are authored and listed
but not executed locally. The backend e2e suite does run locally.

The local Android release APK is
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, signed with
a self-signed key the operator generates and keeps outside the repository.

## Database and backups

- Migrations are generated with `make gen:migrations` and applied with
  `npm run db:migrate` (`make db-migrate`). `make db-reset` is destructive.
- Postgres data lives in named volumes `shat-postgres-dev` / `shat-postgres-prod`.
- Ciphertext attachment blobs live in `/var/lib/shat/attachments` in the
  production image (uid/gid 10001), backed by the named volume
  `shat-attachments-prod`. Never point `ATTACHMENT_STORAGE_DIR` at a container
  path without a volume: `/tmp` and the image filesystem are discarded on
  recreate. Local dev persists blobs under the bind-mounted `var/` directory
  and does not need a separate volume. Include this volume in backups.
- Before any migration or deploy, take a logical backup, for example
  `docker compose -f infrastructure/docker/compose.production.yaml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql`. Verify the dump is
  non-empty and stored outside the volume. Restoring is `pg_dump`'s inverse with
  `psql`; rehearse it before relying on it.
- Base-image tag↔digest pairs were verified via the Docker Hub tag API on
  2026-11-22; all three matched after correcting a stale postgres pin. Re-check
  them before a real deploy because tags can be re-pushed. Images are pinned by
  tag and digest.

## Rollback

1. Set `SHAT_IMAGE_TAG` to the previous known-good immutable tag and redeploy
   the production Compose stack (`up -d`); Compose replaces changed images.
   Never use a mutable `latest` tag as a rollback target.
2. Do **not** assume an automatic database rollback: schema changes are forward
   only. If a deploy changed the schema, restore the pre-deploy `pg_dump` into a
   stopped Postgres instance before starting the older app image.
3. Re-run `make health` and the smoke checks (backend `/health`, web and
   dashboard roots) and confirm the tag actually deployed.
4. Optionally re-run the e2e suites after a rollback: `npm run build` first,
   then `npm run test-e2e` and `npm run test-e2e:browser`. These suites spawn
   their own backend from `dist/apps/backend/src/main.js` and stub HTTP
   responses; they do not contact the redeployed Compose stack. Use
   `make health` and the smoke checks in step 3 to verify that stack. Chromium
   cannot launch in this container (missing `libnspr4.so`, apt lists not
   writable), so the browser specs are authored but not executed locally here.

## Local mobile builds

CI does not build native apps: there is no macOS runner, Android SDK or signing
credential here, so a "green" native build would be false. Local builds behave
as follows:

- `eas build --local` **still authenticates to Expo and requires a linked
  project**. It is convenient for using your own credentials but is not an
  offline build; expect it to fail without Expo auth even with `--local`.
- For a truly offline Android build, prebuild and invoke Gradle directly:
  `npx expo prebuild -p android && cd android && ./gradlew :app:assembleRelease`.
  This needs **JDK 17**, **Android SDK 36** and **build-tools 36.0.0** installed
  locally. Generated `android/`, `ios/` and `.expo/` directories are gitignored.
- iOS builds require **macOS and Xcode** and cannot be produced on Linux.
- Signing material (keystores, provisioning profiles, certificates) must be
  generated by the operator and kept **outside the repository**; none is
  committed here.

`app.json` carries `android.package` / `ios.bundleIdentifier` and `eas.json`
defines `local` / `localRelease` profiles for the Expo path.

## Native and E2EE caveats

Native mobile builds (Xcode/Android SDK), SQLCipher on device, Wi-Fi Direct /
Wi-Fi Aware, CallKit/PushKit/Core-Telecom, TURN interop with external peers and
end-to-end encryption are **not** verified here. EAS builds remain manual until
signing credentials and a macOS runner exist; CI must not report a green native
mobile build. See `apps/mobile/README.md`, ADR 0006 and `CHANGELOG.md`.
