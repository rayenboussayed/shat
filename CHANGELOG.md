# CHANGELOG

All notable changes to SHAT (spec v1.0-draft, §14) are recorded here, one
entry per subtask. Date format: `YYYY-MM-DD`. Build-phase subtasks use the
`P<n>` ids used in the Build phase section below.

## Release v1.0.0 (2026-11-23)

This is a GitHub-only release. It is published by a signed v1.0.0 git tag,
which triggers the release workflow. The signed APK is the Android asset for
the `v1.0.0` GitHub Release.

- Container images: the release workflow publishes three images to GHCR under
  immutable `sha-<commit>` tags (`SHAT_IMAGE_TAG=sha-<commit>`): `shat-backend`,
  `shat-web` and `shat-dashboard`. No `latest` tag is published.
- Android: a release APK for `com.shat.app` is built locally with an upload key
  held outside the repo. The APK is gitignored and is not committed. No AAB is
  produced and there is no Play Store submission.
- End-to-end tests: cross-platform e2e coverage is part of this release.
  Playwright Chromium suites drive the web SPA and the dashboard SPA from the
  root Playwright config. The backend API contract is covered by the Vitest e2e
  project. Maestro flows with an EAS workflow cover the Android app. The backend
  suite ran locally. The browser specs are authored and listed but could not
  launch here because Chromium lacks libnspr4.so and the container cannot
  install system packages. The Maestro flows are authored but not executed
  here, since running them needs Expo authentication and an emulator.
- iOS is out of scope. No iOS binary is published for this release.
- Distribution limits: there is no Google Play or Apple App Store submission and
  no AAB. Publication is the pushed signed tag, the GHCR images produced by the
  release workflow, and the signed APK published as the `v1.0.0` GitHub Release
  asset.

## S1 — scaffold — 2026-11-21

- Repo skeleton per spec §14: `apps/`, `packages/`, `infrastructure/`,
  `scripts/`, `docs/` roots and initial structure.
- Tooling: npm 12.2.3 (lockfile `package-lock.json`), `tsconfig.base.json`
  (strict, `noEmit`), `eslint.config.js` (flat, typescript-eslint),
  `commitlint.config.mjs` (Conventional Commits; type-enum from spec §18.3;
  header-max-length 100; body-max-line-length 100 added in the review pass),
  husky hooks (`pre-commit` runs `npm run check`, `commit-msg` runs
  commitlint), `knip.json`, `.editorconfig`, `.gitignore` (including
  `.husky/_/`), `.nvmrc` (26.13.1).
- `Makefile` target table matching spec §15.3 plus additions
  (`test-coverage`, `test-e2e`, `test-perf`, `test-mem`, `gen:migrations`,
  `docker-build`, `docker-push`); `help` lists all targets. npm is the
  package manager throughout (user correction).
- Scripts: `bootstrap.sh`, `check-prerequisites.sh`, `setup-environment.sh`,
  `health-check.sh`, `build-all.sh`, `run-in-workspaces.sh`.
- ADR template (`docs/adr/adr-template.md`) aligned with plan conventions
  (Status options ACCEPTED/PROPOSED/REVISED/SUPERSEDED, Date, Owner);
  ADR index (`docs/adr/README.md`) points to the required-ADR list in
  `docs/adr/required-adrs.md` (spec §14.1); `@vitest/coverage-v8@5.1.1`
  added to devDependencies.
- `README.md` (spec overview and development quickstart).

## Build phase (P0–P13)

- **P0 — 2026-11-21** (`049a6b0`): NestJS agent skills added; pre-existing
  baseline gate failures repaired (missing database scripts, TS5096).
- **P1 — 2026-11-21** (`67193b5`): Fastify bootstrap and health migrated to
  NestJS 12 with a typed controller, single error filter and graceful shutdown.
- **P2 — 2026-11-21** (`e20756a`): Identity, devices and prekeys split into
  NestJS modules with an injectable `DatabaseService` and session-scoped auth.
- **P3 — 2026-11-21** (`615ef5b`): Generated OpenAPI types, `shat-api-types`
  workspace, typed e2e client and idempotent `gen:api`.
- **P4 — 2026-11-21** (`86a37e6`): Adversarial security corpus and perf/mem
  oracles; honest §19.2 matrix. Coverage 54.73% statements (baseline 30.87%).
- **P5 — 2026-11-21** (`6ab640d`): Conversations, mailbox and delivery
  receipts modules with atomic idempotency and one shared public-route filter.
- **P6 — 2026-11-22** (`97ae2e1`): Ciphertext-only attachments with HMAC
  capabilities, quota and digest checks; 15/15 real-Postgres integration tests,
  82.2% statements with DB.
- **P7a — 2026-11-22** (`6ab6fd1`): Socket.IO signaling with handshake auth,
  per-device limits, replay dedupe and call-state authorization; also
  registered the P6 `AttachmentsModule`.
- **P7b — 2026-11-22** (`2ae5e8f`): TURN HMAC credentials, aggregated
  telemetry, Terminus v12 admin probes, ADRs 0003/0004 and `.env.example`;
  integration verified 15/15 with real Postgres.
- **P8 — 2026-11-21** (`bea2751`): Web shell with React 19.3, Vite 8,
  TanStack Router, StyleX, typed client, Ghost Mode default and strict
  production CSP.
- **P9 — 2026-11-21** (`e39a233`): Web messaging UI: conversations list,
  demo composer, mailbox poll, safety-number panel and runtime response guards.
- **P10 — 2026-11-21** (`40ec944`): Dashboard with typed health check, honest
  metrics panel and exhaustive route list.
- **P11 — 2026-11-21** (`050dd97`): Expo 58 mobile shell with Paper theme,
  typed client and fail-closed SQLCipher gate; Expo Doctor 20/20.
- **P12 — 2026-11-21** (`be8de55`): Mobile ciphertext storage, Ghost mode
  controller, Paper chat screen and transport/call/crypto contracts with
  unverified fail-closed adapters.
- **P13 — 2026-11-22** (`3ad1431`): Multi-stage non-root Dockerfiles and
  dev/prod Compose with real smoke verification; image sizes backend 328 MB,
  web 106 MB, dashboard 106 MB.

## Accepted findings and caveats

- **Accepted audit finding — 2026-11-21**: `npm audit --omit=dev` is red with
  three moderate upstream `expo` advisories. The user accepted this risk; no
  override or audit-level change was added; the root `--omit=dev` baseline was
  clean (0 vulnerabilities) before mobile was added.
- **Digest verification — 2026-11-22**: Base-image tag↔digest pairs were
  verified via the Docker Hub tag API. A stale `postgres:16-alpine` digest was
  corrected; all three pins now match their tags. Re-check before a real deploy.
- **CI/docs (P14) — 2026-11-22**: Hardened PR and release workflows, final
  architecture and runbook, accurate ADR index and the crypto-facade ADR.
  No app code changed.

## Final accepted fixes (Implementer C) — 2026-11-22

- **Docs honesty**: README no longer claims end-to-end encryption; it states
  ciphertext transport scaffolding and the interface-only crypto facade
  (ADR 0006). Unit/integration counts and the final no-DB coverage figures were
  updated; coverage thresholds remain unenforced. Added the Expo-auth, macOS
  iOS and Gradle/JDK/Android-SDK prerequisites for local mobile builds.
- **Local builds**: `docs/operations.md` gained a "Local mobile builds" section
  (`eas build --local` still authenticates and needs a linked project; offline
  Android via `expo prebuild` + `./gradlew :app:assembleRelease` with JDK 17,
  Android SDK 36, build-tools 36.0.0; iOS needs macOS/Xcode; signing material
  stays outside the repo), the `ATTACHMENT_CAPABILITY_KEY` env row and a secret
  handling limitation note (ADRs 0009 and 0005).
- **Attachment persistence**: backend runtime creates and chowns
  `/var/lib/shat/attachments` (uid 10001) and production Compose mounts named
  volume `shat-attachments-prod` there (ADR 0007). Smoke test confirmed the
  mount, uid-10001 write/read and `/health` 200.
- **Secret handling**: the backend reads tokens only from `process.env` (no
  `*_FILE`), so Compose `secrets:` file mounts would be unreadable. Env injection
  is kept with explicit comments and a runbook note that a secret manager must
  populate the deploy environment; no secret is in the repo or an image layer.
- **CSP**: nginx now sends an HTTP `Content-Security-Policy` with
  `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`,
  `default-src 'self'` and `style-src 'self'` for the extracted stylesheet; no
  localhost origins are hardcoded (ADR 0008). Verified with `curl -I` on web and
  dashboard.
- **Image tag**: production Compose requires `SHAT_IMAGE_TAG` (`:?` error) so the
  stale `sha-2ae5e8f` default cannot be deployed; config validation in CI and
  `make compose-config` supplies a throwaway tag (ADR 0005).
- **SPA vulnerabilities**: `apk upgrade --no-cache` was added to both SPA
  runtime stages; libxml2 2.13.9-r2 → 2.13.9-r3. Trivy 0.76.2 reports **0**
  HIGH/CRITICAL findings for the rebuilt web and dashboard images.
- **Backend npm advisories (residual, honest)**: `npm audit fix` with no
  overrides/audit-level change made **no** lockfile changes — the project
  already pins undici 8.13.1 and brace-expansion 5.0.13. A fresh backend image
  rebuild and Trivy scan still report HIGH npm findings because they originate
  in the npm CLI bundled into the pinned Node base image, not in app
  dependencies; unfixed Debian base-package findings also remain. No override
  or floating base was added to mask them. Clearing them requires a patched npm
  in the runtime base or a distroless runtime. `npm audit --omit=dev` still has
  the three user-accepted moderate `expo` advisories.
- **CI**: `pr.yml` gained top-level `concurrency` and a 30-minute job timeout;
  `gen:api:check` remains a required gate. Action SHA pins are unchanged.
