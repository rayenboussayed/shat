# SHAT ADR index — spec v1.0-draft §14.1

All decisions worth revisiting live as ADRs here. Each ADR file follows
`docs/adr/adr-template.md` and records decision, consequences, evidence and
revisit trigger. The authoritative list of required topics is
[required-adrs.md](required-adrs.md).

## Accepted ADRs

- [0001 File storage for encrypted attachments](0001-file-storage.md) —
  required topic 9 (local filesystem blobs, metadata in PostgreSQL).
- [0002 Server signaling topology and transport](0002-signaling-topology.md) —
  required topic 5 (authenticated WebSocket signaling, P2P media, TURN fallback).
- [0003 TURN credential policy (coturn not deployed)](0003-turn-credentials.md) —
  supporting decision for topic 5; coturn is intentionally not deployed here.
- [0004 Observability, aggregated telemetry and retention](0004-observability-retention.md) —
  required topic 10.
- [0005 Compose and Kubernetes packaging](0005-compose-kubernetes-packaging.md) —
  required topic 8 (immutable tag-level images, dev/prod Compose).
- [0006 Crypto facade boundary](0006-crypto-facade.md) —
  required topic 2, facade only: a reviewed-operations interface with no
  algorithm chosen or certified.
- [0007 Persistent ciphertext attachment volume](0007-attachment-persistence-volume.md) —
  supporting decision for topic 9: named production volume so blobs survive
  container recreation.
- [0008 HTTP Content-Security-Policy for the SPAs](0008-http-csp-for-spa.md) —
  supporting decision for the web/dashboard deployment contract: real HTTP CSP
  because meta `frame-ancestors` is ignored.
- [0009 Local and offline mobile builds](0009-offline-mobile-builds.md) —
  supporting decision documenting the Expo-auth limitation, the Gradle offline
  Android path and the macOS-only iOS path.

## Required topics decided without a standalone ADR file

These decisions are made and visible in the repository, but no numbered ADR was
authored for them; they are recorded here rather than claimed as ADRs:

- Topic 1, package manager and monorepo tool — S1/P0 selected npm 12 with npm
  workspaces (`package.json`, `package-lock.json`); no pnpm files. Evidence:
  `CHANGELOG.md` S1 and `package.json`.
- Topic 7, database schema strategy — the pre-baseline schema commit `e103c96`
  selected Drizzle ORM with generated SQL migrations on PostgreSQL
  (`packages/database`, `apps/backend` migrations).
  Evidence: `package.json` dependencies and migration files.

## Deferred required topics (no decision made)

Do not claim these as accepted. Their implementation subtasks were not built in
this scope, so there is no ADR to index:

- Topic 3, local discovery and transport per platform — deferred. The mobile
  work added TypeScript contracts and fail-closed, unverified adapters only;
  no Wi-Fi Direct / Wi-Fi Aware transport was selected or validated.
- Topic 4, WebRTC library — deferred. Call contracts exist
  (`apps/mobile/src/calls/contracts.ts`), but no library was chosen or
  certified in this environment.
- Topic 6, push notification policy — deferred. No native push integration or
  provider policy was selected; no ADR.

See `apps/mobile/README.md` for the full list of unverified native capabilities
and `CHANGELOG.md` for the build-phase history.
