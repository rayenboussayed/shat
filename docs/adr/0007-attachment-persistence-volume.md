# ADR 0007: Persistent ciphertext attachment volume

- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT infrastructure

## Context
ADR 0001 chose local filesystem blobs for ciphertext attachments, with metadata
in PostgreSQL. The production backend image initially set
`ATTACHMENT_STORAGE_DIR=/tmp/attachments`: `/tmp` is world-writable so uid 10001
could create it, but both `/tmp` and the image filesystem are discarded when a
container is recreated. Production Compose mounted only the Postgres volume, so
blob bytes were lost on every redeploy while metadata survived — a silent data
loss bug.

## Options considered
- Keep `/tmp/attachments`: no image change, but blobs vanish on recreate.
  Rejected.
- Write blobs into PostgreSQL: durable but changes the storage contract in ADR
  0001 and bloats the database. Rejected for this scope.
- Create a uid-10001-owned directory under `/var/lib/shat` and back it with a
  named Compose volume. Chosen: preserves ADR 0001, is explicit and backup-able.

## Decision
- The backend `runtime` stage creates `/var/lib/shat/attachments`, chowns
  `/var/lib/shat` to 10001:10001 and sets
  `ATTACHMENT_STORAGE_DIR=/var/lib/shat/attachments` (infrastructure/docker/Dockerfile).
- `compose.production.yaml` mounts named volume `shat-attachments-prod` at that
  path and sets the same env value explicitly. Dev keeps the bind-mounted `var/`
  directory and needs no extra volume.
- The volume must be included in backup/restore drills (docs/operations.md).

## Consequences
- Upgrading or replacing the backend image preserves blobs; deleting the volume
  destroys them, so `docker compose down -v` is destructive in production.
- Attaching a different volume or overriding `ATTACHMENT_STORAGE_DIR` without a
  volume returns to the lossy behaviour; operators must keep both in sync.
- The dev and prod paths differ; docs state which persistence applies where.

## Evidence and sources
- ADR 0001 (file storage), ADR 0005 (packaging), `docs/operations.md`.
- Production Compose smoke test ran the stack and verified the directory is
  writable as uid 10001 (blob write/read round-trip) and `/health` returns 200.

## Revisit trigger
- Attachments move to object storage or PostgreSQL large objects.
- A second backend replica needs shared blob storage.
