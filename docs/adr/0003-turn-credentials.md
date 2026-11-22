# ADR 0003: TURN credential policy (coturn not deployed)
- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT backend

## Context
WebRTC calls behind NAT need a TURN relay (spec §3.6, §9.4). The backend must hand
each device short-lived TURN credentials without storing per-user TURN passwords.
No coturn server is installed or deployed in this repository; this ADR covers only
the credential-minting and policy layer. Nothing here claims a working relay.

## Options considered
- Static long-lived username and password per user: simple, but a leaked pair works
  until rotated, and rotation touches every client.
- Server-side TURN accounts in coturn's database: needs coturn's account store and
  an extra shared database to keep in step with SHAT.
- coturn REST shared-secret (`use-auth-secret`): the backend mints
  `<expiry>:<deviceId>` plus a MAC keyed by a secret that only the backend and coturn
  hold. Credentials expire on their own and need no per-user state.

## Decision
Use the coturn REST shared-secret scheme:
- `POST /turn/credentials` requires a valid session (AuthService). It returns a
  username `<unix-expiry>:<deviceId>` and a password, the base64 of
  HMAC-SHA1(TURN_SECRET, username).
- Lifetime is fixed at 300 seconds. Verification rejects expiries more than 300 seconds
  ahead, so a valid MAC with a longer lifetime is refused.
- HMAC-SHA1 is used only because coturn verifies that MAC for REST secrets. HMAC stays
  a secure MAC with SHA-1; the choice does not weaken forgery resistance.
- `TURN_SECRET` must be at least 32 characters **and** at least 16 distinct
  characters; the shared `readSecretEnv` helper in
  `apps/backend/src/admin/env-secret.ts` enforces both. Missing, short or
  repetitive values fail closed with 503 and issue nothing. `TURN_URIS` lists
  `turn:`/`turns:` URIs; other entries are ignored.
- Comparisons use the constant-time helper in AuthService. Passwords are compared as
  exact canonical base64 strings, so padding or encoding variants are rejected.
- Credentials are never logged, and the 503 body never echoes configuration.

## Consequences
- A leaked credential is valid for at most five minutes. Revoking a device stops new
  credentials but does not cut an existing credential short; the expiry bounds that
  window.
- The secret is shared with coturn. Rotating it invalidates all outstanding
  credentials at once, which is acceptable at five-minute lifetimes.
- `verify()` in `apps/backend/src/turn/turn.service.ts` documents the check coturn
  performs. The server does not receive TURN traffic, so it is not called in the
  request path.
- Deploying coturn with `static-auth-secret` / `use-auth-secret` and matching
  `TURN_SECRET` is a separate infrastructure task. Until then, TURN relaying is not
  available.
- The device ID is embedded in the username in cleartext. It is therefore visible
  to the TURN operator and in coturn's logs; it identifies a device, not a message
  or a person, but relaying through a third party leaks that device identifier.

## Evidence and sources
- coturn TURN REST API documentation (`use-auth-secret`, `static-auth-secret`):
  https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api — HMAC-SHA1 over
  the username, base64-encoded, as the long-term password.
- Spec §3.6, §9.4 (relay through the backend, no media storage).
- Implementation: `apps/backend/src/turn/`, tests in `apps/backend/tests/unit/turn.test.ts`.

## Revisit trigger
- coturn is deployed, or its REST scheme changes (for example, a stronger MAC is
  supported).
- Multi-instance deployment: the secret is shared by configuration, so no state is
  needed, but the secret-rotation procedure must be written.
