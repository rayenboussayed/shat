# ADR 0001: File storage for encrypted attachments
- Status: Accepted
- Date: 2026-11-21
- Owner: SHAT backend

## Context
Spec §6.3 and §14.1 require a file storage decision. The server must hold attachment
ciphertext only: it never sees keys or plaintext, and it must bound uploads, quotas and
retention. The backend is a single NestJS/Fastify process with PostgreSQL. The Fastify
default body limit is 1 MiB and is not changed per route here.

## Options considered
1. PostgreSQL `bytea` in the `attachments` row. Simple and transactional, but blobs bloat
   the table, WAL and backups, and every read goes through the connection pool.
2. Local filesystem blobs behind a storage interface, with metadata in PostgreSQL. Blobs
   are opaque files under a private directory named by a random UUID. Metadata and quota
   live in the database.
3. Object storage (S3-compatible). The right target for multi-node deployments, but it
   adds a provider, credentials and a network failure mode that the current single-node
   deployment does not need.

## Decision
Option 2. `AttachmentStorage` is an interface; `FileSystemAttachmentStorage` is the only
implementation. Storage keys are random UUIDs that are unrelated to attachment ids, and
the adapter rejects any key that is not a UUID, so user input cannot traverse paths.
Blob files are created with mode 0600 in a 0700 directory and are never served statically.

- Upload: ciphertext is base64 in JSON, at most 512 KiB decoded. The SHA-256 digest must
  match the bytes. Expiry must be in the future and at most 30 days away.
- Quota: 64 MiB of non-deleted ciphertext per owner device. The check runs in a
  transaction under a per-owner advisory lock.
- Download: `GET /attachments/:id` (owner only) issues an HMAC-signed capability valid for
  60 seconds and never beyond the attachment expiry. `GET /attachments/download?token=`
  validates the signature and expiry, checks that the row is live, and re-verifies the
  stored digest before sending bytes with `no-store`.
- Delete: the row is marked deleted, then the blob is removed, then the row is deleted.
  A failed blob removal leaves a marked row for the purge job to retry.
- Purge: `AttachmentsService.purgeExpired` removes at most 100 expired or deleted
  attachments per call. A scheduler calls it; no cron is wired in this change.

The capability key comes from `ATTACHMENT_CAPABILITY_KEY` (base64, at least 32 bytes).
If unset, a random per-process key is used, so tokens stop working after a restart.

## Consequences
- Ciphertext survives restart in `ATTACHMENT_STORAGE_DIR` (default `var/attachments`
  under the working directory). Operators must back up that directory with the database.
- The 512 KiB ceiling is set by the 1 MiB Fastify body limit. Raising it needs a per-route
  body limit, which is a change to the app bootstrap.
- Not implemented: a sweep for blob files with no row. A crash between blob write and
  row commit, or a failed blob removal after a failed insert, can leave an orphan file.
  The row-driven purge does not find it. The orphan sweep needs a grace period and a
  storage listing, and is a follow-up.
- A purge scans `attachments` by `expires_at`/`deleted_at` without a dedicated index.
  Batches are small, but a large backlog will need an index on `expires_at`.

## Evidence and sources
- Schema: `packages/database/src/schema.ts` (`attachments`, owner/deleted index).
- Body limit: Fastify default `bodyLimit` of 1 MiB (`apps/backend/src/app.ts`).
- Tests: `apps/backend/tests/unit/attachments.test.ts` (DB-free) and
  `apps/backend/tests/integration/attachments.test.ts` (DB-gated, including an EXPLAIN
  check for the owner index). The integration test skips without `DATABASE_URL`.

## Revisit trigger
- More than one backend node, or blobs over 1 MiB, or total ciphertext over 10 GiB.
- An orphan-file count above zero in operations checks.
- Any requirement for regional replication or retention beyond 30 days.
