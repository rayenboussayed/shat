# CHANGELOG

All notable changes to SHAT (spec v1.0-draft, §14) are recorded here, one
entry per subtask. Date format: `YYYY-MM-DD`.

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

## Later subtasks

One entry per subtask (S2–S24, spec §20): backend schema (S2), Fastify
skeleton (S3), identity/devices/prekeys (S4), conversations/mailbox (S5),
attachments (S6), signaling WS (S7), TURN (S8), admin/telemetry (S9),
tests hardening (S10), web shell (S11), web messaging UI (S12), dashboard
(S13), mobile skeleton (S14), mobile storage (S15), mobile messaging UI
(S16), mobile local adapters (S17), mobile calls UI (S18), mobile Ghost
mode (S19), perf suite (S20), security hardening (S21), Docker/Compose
(S22), CI/Actions (S23), docs (S24).
