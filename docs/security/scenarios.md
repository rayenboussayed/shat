# Security scenarios (SHAT §19.2)

Matrix of §19.2 adversarial scenarios, their control, owning subtask, and
verification status. Every scenario is either covered by an automated test or
listed here as deferred with a reason.

## Covered without a database

| Scenario | Control | Owning subtask | Status |
| --- | --- | --- | --- |
| Malformed frame (invalid JSON body to an identity route) | Fastify body parser + `IdentityExceptionsFilter` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Oversized payload (base64 field beyond 8192 chars) | JSON Schema `maxLength` on `base64Schema` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Invalid identity key byte length | `AuthService.decodeBase64(..., 32)` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Invalid signed prekey public key / signature byte length | `AuthService.decodeBase64(..., 32/64)` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Invalid one-time prekey byte length | `AuthService.decodeBase64(..., 32)` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Unknown session token | `AuthService.getAuthenticatedActor` returns `undefined` -> 401 | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Expired session token | `sessions.expires_at > now()` in the auth query | P4 | Deferred: expiry is enforced in SQL, so exercising it requires `DATABASE_URL` |
| Both session headers supplied at once | `AuthService.getSessionToken` returns `undefined` -> 401 | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Enrollment fail-closed (missing `SHAT_ENROLLMENT_TOKEN` or `SHAT_ENROLLMENT_USER_ID`) | `DeviceService.createDevice` returns 503 | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Constant-time comparison (wrong-length / mismatched token) | `AuthService.matchesSecret` / `matchesUtf8` | P4 | Automated: `apps/backend/tests/unit/security-corpus.test.ts` |
| Request ID not caller-controlled | `requestIdHeader: false` + `genReqId` | P1/P4 | Automated: `apps/backend/tests/unit/app.test.ts` |

## Deferred

| Scenario | Control | Owning subtask | Reason |
| --- | --- | --- | --- |
| Downgrade / tampered input (unknown body property) | `additionalProperties: false` in JSON Schema | P1/P4 | Fastify default validator strips unknown properties instead of rejecting; needs `removeAdditional: false` in `buildApp` |
| Replay | Mailbox idempotency key | S5 | Requires `DATABASE_URL` and mailbox schema |
| Duplicate delivery | Delivery receipt uniqueness | S5 | Requires `DATABASE_URL` and receipt schema |
| Group protocol abuse | Group membership + sender keys | S5 | Requires `DATABASE_URL` and group tables |
| Tampered attachment chunk | Chunk hash verification | S6 | Requires storage and `DATABASE_URL` |
| Decompression bomb | Size limits before decompression | S6 | Requires attachment pipeline and `DATABASE_URL` |
| Signaling bypass | WebRTC signaling authorization | WebRTC subtask | Requires native/platform build |
| TURN abuse | TURN credential scoping | Infrastructure | Requires TURN server and network harness |
| WebSocket flood | Rate limiting + connection caps | Transport subtask | Requires WebSocket server |
| Local discovery spoofing | Platform discovery validation | Native subtask | Requires native platform build |
| SQLCipher missing | Fail-closed database open | S14 | Requires native SQLCipher build |
| Ghost crash recovery | Crash-safe persistence | Native subtask | Requires native client harness |
| Stale push delivery | Push endpoint expiry handling | Push subtask | Requires push service and `DATABASE_URL` |
