# SHAT

Privacy-focused communication platform targeting end-to-end encrypted
one-to-one messaging, app-to-app voice and video calls, encrypted file
transfer, and two deliberately separate transport modes (Local and Online)
behind one security layer. Specification: v1.0-draft (§0–§23). This repository
implements the server, web and dashboard surfaces and the mobile skeleton.
Transport is ciphertext-only scaffolding; **E2EE is not implemented** — ADR
0006 defines an interface-only crypto facade with no algorithm chosen or
certified. Peer-to-peer and native capabilities are scaffolded but **not**
verified here (see "Unverified" below).

## Status

Build phase P0–P13 complete; P14 adds hardened CI and final documentation.
See `CHANGELOG.md` for one entry per subtask and `.agent-swarm/STATE.md` for the
coordinator log. All quality gates (`npm run check`, `npm run test-cov`,
`npm run build`, Compose config validation) exit 0 locally. `npm audit --omit=dev`
is red with three moderate upstream `expo` advisories, accepted by the user with
no override added. `npm audit fix` (no overrides, no audit-level change) made no
lockfile changes: the project already pins undici 8.13.1 and brace-expansion
5.0.13. A fresh Trivy 0.76.2 scan of the backend image still reports HIGH
findings for undici/brace-expansion and unfixed Debian base packages; the npm
ones come from the npm CLI bundled inside the pinned Node base image
(`/usr/local/lib/node_modules/npm/node_modules/`), **not** from app
dependencies. No override or floating base tag was added to hide them; clearing
them needs a runtime base with a patched npm or a distroless runtime. The
rebuilt web and dashboard images scan clean at HIGH/CRITICAL after `apk upgrade`.

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
npm run test-unit                       # 171 passed, 9 skipped
npm run test-integration                # 17 skipped without DATABASE_URL
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
(P6). A final-tree run without `DATABASE_URL` is **77.63% statements
(1156/1489), 63.87% branches, 83.12% functions, 77.74% lines**; with a real
PostgreSQL the integration suites pass (20/20) and statement coverage rises to
about 82%. The gap is largely `DATABASE_URL`-gated identity/prekey code. There
are no configured coverage thresholds, so these numbers are reported, not
enforced as gates; 95% global / 98% domain / 100% crypto remain recommended
targets. Benchmark and memory suites exist but have no numeric baseline to
compare against.

## Architecture and decisions

Two transport modes are the target design; the security layer must never
depend on the transport (§2). What is implemented here is the Online-mode
server surface: identity and prekeys, an encrypted mailbox, a signaling
gateway, and short-lived TURN credentials. Local Mode (§3.1) nearby discovery
and WebRTC media are future work: only fail-closed TypeScript contracts exist
for native transports and calls (§3.4, §12). No client depends on the signaling
gateway yet. Real E2EE is not implemented: ADR 0006 defines an interface-only
crypto facade, and no algorithm is chosen or certified (§5.1, §5.8). The server
uses SHA-256 token hashing and HMAC for capabilities and TURN credentials; it
does not implement Argon2id, HKDF or AEAD message framing. No custom protocol
is invented.

Server: NestJS/Fastify + Drizzle/PostgreSQL. Web: React/Vite/TanStack/StyleX.
Dashboard: React/Vite. Mobile: Expo 58. ADRs and open decisions:
`docs/adr/README.md`, `docs/adr/required-adrs.md`. Deployment env vars, ports,
DB setup, backups and rollback: **`docs/operations.md`** (the runbook).

## Unverified (do not claim as working)

- Native mobile builds, SQLCipher on device, Wi-Fi Direct / Wi-Fi Aware, and
  CallKit/PushKit/Core-Telecom: no macOS runner, Android SDK or device here.
  EAS builds stay manual until signing credentials and a macOS runner exist; CI
  will not report a green native build. `eas build --local` still authenticates
  to Expo and needs a linked project, so it is not an offline build. iOS builds
  require macOS and Xcode and cannot be produced on Linux. A truly offline
  Android build needs JDK 17, Android SDK 36 and build-tools 36.0.0; see
  `docs/operations.md`. Signing material must be generated and kept outside the
  repository.
- End-to-end encryption: ADR 0006 fixes only the crypto **facade** boundary; no
  algorithm is chosen or certified and no E2EE claim is validated.
- TURN interop with external peers: credential minting is tested, live media
  relay is not.
- Base-image tag↔digest pairs were verified via the Docker Hub tag API on
  2026-11-22 and all three now match. A stale postgres pin was corrected.
  Re-check them before a deploy because tags can be re-pushed.
- External registry push: no real registry configured; `SHAT_REGISTRY` is a
  documented namespace placeholder, not a verified target.
- Kubernetes manifests are a separate, unvalidated deployment surface here.
