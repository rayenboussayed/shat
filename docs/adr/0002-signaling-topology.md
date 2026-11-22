# ADR 0002: Server signaling topology and transport
- Status: Accepted
- Date: 2026-11-22
- Owner: SHAT backend

## Context
Spec §3.6 and §9.4 put call setup and ICE negotiation on the server: the backend relays
offers, answers, ICE candidates and call state between two devices. It must not carry
media, store payloads, or route to arbitrary devices. The backend is one NestJS/Fastify
process on PostgreSQL. Sessions are checked against the database at connection time.
Multi-instance routing is unresolved (spec §9.5).

## Options considered
1. Raw `ws` through `@nestjs/platform-ws`. Preferred by the plan, but Nest only uses it
   when the app calls `app.useWebSocketAdapter(...)` before init. Without that call, a
   gateway makes every app that boots the module fail (`loadAdapter` calls
   `process.exit(1)` when `@nestjs/platform-socket.io` is missing). That broke 14 existing
   unit tests, and fixing it needs changes to `main.ts` and to test files outside this
   subtask.
2. Socket.IO through `@nestjs/platform-socket.io` (Nest 12.6.0, socket.io 4.8.4). Nest's
   default adapter is picked up with no extra wiring. Clients need `socket.io-client`.
   Adds reconnection and namespaces, which we do not use.
3. Signaling over HTTP polling or Server-Sent Events. Rejected: higher latency per ICE
   candidate, and ICE trickle needs a client-to-server channel anyway.

## Decision
Option 2. Signaling runs in a NestJS gateway at path `/signaling` on the same HTTP port.
- Handshake: the session token comes from the `Authorization: Bearer` header (native
  clients) or the `auth.token` field (browsers). Without a valid session the socket gets
  one `signal.error` frame and is disconnected.
- Events: one `signal` event carries client events, server replies and relayed events.
  Envelope version 1 has an id, type, call id, sentAt, expiresAt and a bounded payload.
- Sender: always the authenticated device. The server stamps `from`.
- Recipient: `call.invite` names one explicit `to` device, which must be an active device of
  the same user (no contact model exists yet). Every later event goes to the other participant
  from call state, so a client-supplied `to` on those events is ignored.
- State machine: only the callee accepts or rejects; only the caller invites or cancels; SDP
  flows caller offer and callee answer, only in the active phase. Other events are refused
  with a code.
- Limits: 16 KiB per event, 30 events per minute per device (shared by all its sockets on
  this instance), at most 4 open sockets per device per instance, 60-second maximum event
  lifetime, replay dedupe of 60 seconds per call on event id, 10,000 tracked event ids and 10,000 calls
  per process. Above a limit the server refuses rather than evicts. Replay ids are recorded only
  after the event is authorized, so refused events cannot use up the dedupe capacity.
- `session.reconnect` refreshes an active call's lifetime but never a ringing call's, so a
  ringing call still expires one minute after it started.
- Offline peers: `signal.offline` is returned and nothing is stored. No mailbox is used. An offline
  peer still ends the call for `call.end`, `call.cancel` and `call.reject`, as the online path does.
- Logging: event type, call id and outcome only. Payloads are never logged or stored.

## Consequences
- Clients use `socket.io-client`. The mobile and web clients need that dependency.
- Call state, presence and replay state live in process memory. A call set up on one
  instance cannot be continued on another, and a restart drops ringing and active calls.
  Multi-instance use needs an external store or a sticky-session plan (spec §9.5). That is
  not solved here, and no broker has been added.
- A device that is revoked mid-call is refused on its next event, but its open socket stays
  open until it disconnects.
- The rate limit and socket cap are per process. A device can send 30 events per minute and
  hold 4 sockets on each instance, so running several instances multiplies both limits. Replay
  dedupe is per process too. This gap stays open until spec §9.5 is resolved.
- Before the offline-effect fix, an offline `call.end`, `call.cancel` or `call.reject` left the
  call tracked until its lifetime ended. That now ends the call on every path, invite and relay alike.
- Socket.IO's own packet framing adds overhead on top of the 16 KiB event limit. The
  transport limit (`maxHttpBufferSize`) is set just above the event limit.

## Evidence and sources
- Nest 12.6.0 `@nestjs/platform-socket.io` and `@nestjs/websockets` installed from npm; the
  `loadAdapter` `process.exit` path observed in `node_modules/@nestjs/websockets/socket-module.js`.
- Unit tests: `apps/backend/tests/unit/signaling.test.ts` (50 cases, including auth, schema,
  authorization, size, rate limit, socket cap, offline effects, reconnect and replay), run by
  `npm run test-unit`.
- Manual, not reproduced in CI: a one-off script against a running Nest app with
  `socket.io-client` 4.8.4 showed unauthenticated connect refused; token from header and from
  `auth.token` accepted; invite, accept, offer, answer and ICE relayed to the counterpart only; a
  client `to` on an offer ignored. The script was run from a scratch directory and is not committed,
  so no artifact backs this claim.

## Revisit trigger
- Spec §9.5 is resolved, or the backend runs more than one instance.
- Clients need a transport without Socket.IO framing (for example native WebSocket only).
- Presence or call state must survive a restart.
