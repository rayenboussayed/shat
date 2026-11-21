# SHAT

Privacy-focused communication platform: end-to-end encrypted one-to-one
messaging, app-to-app voice and video calls, encrypted file transfer, and two
deliberately separate transport modes (Local and Online) behind one security
layer. Specification: v1.0-draft (§0–§23); this repository implements it.

## Status

S1 — repository skeleton: npm monorepo, tooling, Makefile target table
(spec §15.3), scripts, ADR template, README, CHANGELOG. See
`CHANGELOG.md` and `.agent-swarm/STATE.md` for progress by subtask.

## Development

```bash
./scripts/bootstrap.sh   # install, prerequisites, environment
make check               # typecheck + lint + knip + unit/integration tests
make dev                 # native dev servers (spec §15.4)
make health              # backend health check (spec §15.4)
```

Full target table: `make help`. Database: `make db-up`, `make db-migrate`
(spec §15.5). Per-app build/dev targets land with their subtasks (spec §15.3).

## Architecture (spec v1.0-draft)

Two modes behind one security layer — the security layer never depends on
the transport (§2):

- **Local Mode** (§3.1): nearby-device discovery and connection without
  Internet or SHAT infrastructure. Android Wi-Fi Direct / Wi-Fi Aware,
  Apple Wi-Fi Aware / Network-framework peer-to-peer, and other documented
  platform mechanisms are candidates (§3.4).
- **Online Mode** (§3.6): SHAT-operated identity, rendezvous and signaling
  over authenticated WebSocket; WebRTC media goes peer-to-peer when possible,
  with a self-hosted TURN relay fallback (§3.8).

Cryptography (§5): Argon2id passwords, HKDF key derivation with context
separation, AEAD framing, key hierarchies (§5.4). Never invent protocol
suites: use well-reviewed specifications and libraries (§5.1, §19).

Server side: Fastify + Node.js + Drizzle ORM on PostgreSQL (§9). Client side:
StyleX + React 19 (web, §11); Expo/React Native (mobile, §10).

ADRs and open decisions: `docs/adr/README.md`, `docs/adr/adr-template.md`.
