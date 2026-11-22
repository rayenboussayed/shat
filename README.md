# SHAT

Privacy-focused communication platform: end-to-end encrypted one-to-one
messaging, app-to-app voice and video calls, encrypted file transfer, and two
deliberately separate transport modes (Local and Online) behind one security
layer. Specification: v1.0-draft (§0–§23). This repository implements the
server, web and dashboard surfaces and the mobile skeleton; encrypted,
peer-to-peer and native capabilities are scaffolded but **not** verified here
(see "Unverified" below).

## Status

Build phase P0–P13 complete; P14 adds hardened CI and final documentation.
See `CHANGELOG.md` for one entry per subtask and `.agent-swarm/STATE.md` for the
coordinator log. All quality gates (`npm run check`, `npm run test-cov`,
`npm run build`, Compose config validation) exit 0 locally. `npm audit --omit=dev`
is red with three moderate upstream `expo` advisories, accepted by the user with
no override added.

## Stack

- **Backend:** NestJS 12 on Fastify 5, Drizzle ORM 0.45 on PostgreSQL 16,
  terminus health probes and in-process aggregated telemetry, generated OpenAPI
  types.
- **Web:** React 19.3 + Vite 8 + TanStack Router + StyleX 0.19, typed API
  client, strict production CSP, Ghost Mode default-on.
- **Dashboard:** React + Vite, typed health check and honest metrics panel.
- **Mobile:** Expo 58 / React Native 0.88 with Paper M3 theme, fail-closed
  SQLCipher gate, Ghost Mode controller, typed client; native features are
  unverified in this environment.
- **Packaging:** multi-stage non-root images, dev/prod Compose, immutable
  tag-level pinning. Mobile is intentionally not containerised.

## Bootstrap and development

Node 26.13.1 (`.nvmrc`) and npm 12.2.3, PostgreSQL 16 for DB-backed tests.

```bash
./scripts/bootstrap.sh         # install, prerequisites, environment
cp .env.example .env           # fill in generated secrets; never commit .env
make check                     # typecheck + lint + knip + tests
make db-up                     # PostgreSQL (dev Compose)
npm run db:migrate             # apply Drizzle migrations
npm start -w apps/backend      # backend on 3000 (npm run dev is a no-op in workspaces without a dev script)
make health                    # backend /health check
```

Full target table: `make help`.

### Docker

```bash
make dev-docker                # dev stack: backend 31001, web 31002, dashboard 31003
make compose-config            # validate the dev Compose file; PR CI validates both
npm run compose-config         # same, via package.json
# Production (built artifacts, no bind mounts):
SHAT_IMAGE_TAG=sha-<git-sha> SHAT_REGISTRY=<ns/> \
  docker compose -f infrastructure/docker/compose.production.yaml up -d
# prod ports: backend 31004, web 31005, dashboard 31006
```

Only host ports 31000–31099 are forwarded in the verification environment; a
reverse proxy terminates TLS and maps real public ports.

### Test suites

```bash
npm run test-unit                       # 165 passed, 9 skipped
npm run test-integration                # 15 skipped without DATABASE_URL
npm run test-e2e                        # 3 passed (typed API contract)
npm run test-cov -- --coverage.reporter=text --coverage.reporter=json-summary
npm run test-perf                       # vitest bench (no baseline files yet)
npm run test-mem                        # GC-exposed memory suite
npm run build                           # all workspaces
```

Integration tests require `DATABASE_URL` and skip otherwise. With it set, the
P6 verification ran 15/15 real-Postgres integration tests.

### Coverage and baseline

The true baseline (commit `f00088a`, before code changes) was **30.87%
statements / 13.58% branches / 40.78% functions / 31.31% lines**, with baseline
gates failing on missing database scripts and a TS5096 build error (repaired in
P0). Coverage rose to 54.73% statements (P4) and 82.2% with a real database
(P6). The current local run without `DATABASE_URL` is **78.1% statements
(1070/1370), 65.24% branches, 82.59% functions, 78.52% lines** — the gap is
largely `DATABASE_URL`-gated identity/prekey code. No benchmark or memory
baseline files exist yet, so those suites are recorded as absent, not regressed.

## Architecture and decisions

Two transport modes sit behind one security layer; the security layer never
depends on the transport (§2). Local Mode (§3.1) covers nearby-device discovery
without Internet or SHAT infrastructure; Online Mode (§3.6) uses authenticated
WebSocket rendezvous/signaling and WebRTC media with a self-hosted TURN relay
fallback. Cryptography (§5) uses reviewed specifications and libraries only —
Argon2id passwords, HKDF with context separation, AEAD framing and key
hierarchies; no custom protocol is invented (§5.1, §5.8, §19).

Server: NestJS/Fastify + Drizzle/PostgreSQL. Web: React/Vite/TanStack/StyleX.
Dashboard: React/Vite. Mobile: Expo 58. ADRs and open decisions:
`docs/adr/README.md`, `docs/adr/required-adrs.md`. Deployment env vars, ports,
DB setup, backups and rollback: **`docs/operations.md`** (the runbook).

## Unverified (do not claim as working)

- Native mobile builds, SQLCipher on device, Wi-Fi Direct / Wi-Fi Aware, and
  CallKit/PushKit/Core-Telecom: no macOS runner, Android SDK or device here.
  EAS builds stay manual until signing credentials and a macOS runner exist; CI
  will not report a green native build.
- End-to-end encryption: ADR 0006 fixes only the crypto **facade** boundary; no
  algorithm is chosen or certified and no E2EE claim is validated.
- TURN interop with external peers: credential minting is tested, live media
  relay is not.
- Tag↔digest correspondence of pinned base images: registry unreachable here;
  a control tag lookup also failed. Pinning is immutable-tag level, not digest.
- External registry push: no real registry configured; `SHAT_REGISTRY` is a
  documented namespace placeholder, not a verified target.
- Kubernetes manifests are a separate, unvalidated deployment surface here.
