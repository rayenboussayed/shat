# CHANGELOG

All notable changes to SHAT (spec v1.0-draft, §14) are recorded here, one
entry per subtask. Date format: `YYYY-MM-DD`. Build-phase subtasks use the
`P<n>` ids from `.agent-swarm/STATE.md`.

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
- `README.md` (spec overview and development quickstart),
  `TASKS.md`-style journal moved to `.agent-swarm/STATE.md`.

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
  dev/prod Compose with real smoke verification; image sizes backend 416 MB,
  web 95.6 MB, dashboard 95.4 MB.

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
