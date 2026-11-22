# Security scenarios (SHAT §19.2)

Matrix of §19.2 adversarial scenarios, their control, and verification status.
"Automated" means a test runs in this environment; "DB-gated" means the test
needs `DATABASE_URL` (it passed against a real PostgreSQL during this build);
"Deferred" means no implementation exists and the reason is stated.

## Covered

| Scenario | Control | Status |
| --- | --- | --- |
| Malformed frame (invalid JSON body) | Fastify body parser + public error filter | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Oversized payload (base64 beyond schema bound) | JSON Schema `maxLength` | Automated: `security-corpus.test.ts` |
| Invalid identity key / signed prekey / one-time key lengths | Canonical base64 with exact byte lengths | Automated: `security-corpus.test.ts` |
| Unknown session token, both session headers | Session auth via `AuthService` | Automated: `security-corpus.test.ts` |
| Enrollment fail-closed | Secret and owner validated at enrollment | Automated: `security-corpus.test.ts` |
| Constant-time comparison | `timingSafeEqual` with length checks | Automated: `security-corpus.test.ts` |
| Request ID not caller-controlled | `requestIdHeader: false` + generated UUID | Automated: `apps/backend/tests/unit/app.test.ts` |
| Replay / duplicate signaling event | Bounded TTL replay guard by event id | Automated: `apps/backend/tests/unit/signaling.test.ts` |
| Signaling authorization bypass | Handshake auth and call-state role checks | Automated: `signaling.test.ts` |
| WebSocket flood | Per-device event rate limit and socket cap | Automated: `signaling.test.ts` |
| TURN credential abuse | Short-lived HMAC credentials bound to device | Automated: `apps/backend/tests/unit/turn.test.ts` |
| Tampered attachment / digest mismatch | SHA-256 digest verification before delivery | Automated: `apps/backend/tests/unit/attachments.test.ts` and DB-gated integration |

## DB-gated (passed with a real PostgreSQL during this build)

| Scenario | Control | Status |
| --- | --- | --- |
| Duplicate delivery | Receipt created once per message; ack is idempotent | `apps/backend/tests/integration/mailbox.test.ts` |
| Mailbox ownership / expired envelope | Recipient-scoped poll, expiry bound | `mailbox.test.ts` (unit + integration) |
| Concurrent prekey claim / device conflict | `FOR UPDATE SKIP LOCKED`, `ON CONFLICT` | `identity.test.ts` |

## Deferred (no implementation; reason stated)

| Scenario | Reason |
| --- | --- |
| Downgrade / tampered unknown body property | Fastify's default Ajv strips unknown properties instead of rejecting them; a strict `removeAdditional: false` change is a separate bootstrap change |
| Group protocol abuse | Group key management is a separate protocol milestone (§4.5) |
| Decompression bomb | No compression in the current envelope path; a future compressed envelope needs output limits |
| Local discovery spoofing | Native platform adapters are interface-only contracts here |
| SQLCipher missing on device | Fail-closed gate is unit-tested; device verification needs a native build |
| Ghost crash recovery / stale push | Native client and push service are deferred (§21) |
