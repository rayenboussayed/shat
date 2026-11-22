import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { AuthService } from "../../src/identity/auth.service.ts";
import type { Actor, SessionHeaders } from "../../src/identity/schemas.ts";
import { CallRegistry } from "../../src/signaling/call-state.ts";
import { ConnectionRegistry, MAX_SOCKETS_PER_DEVICE } from "../../src/signaling/connections.ts";
import {
  ConnectionRateLimiter,
  RATE_LIMIT_EVENTS,
  REPLAY_GUARD_CAPACITY,
  ReplayGuard,
} from "../../src/signaling/guards.ts";
import { MAX_EVENT_BYTES, SIGNAL_EVENT, validateEnvelope } from "../../src/signaling/schemas.ts";
import { SignalingGateway, handshakeHeaders } from "../../src/signaling/signaling.gateway.ts";
import type { SignalingSocket } from "../../src/signaling/signaling.gateway.ts";
import { SignalingService } from "../../src/signaling/signaling.service.ts";

const NOW = Date.parse("2026-11-22T10:00:00.000Z");
const UA = randomUUID();
const UB = randomUUID();
const A1 = randomUUID();
const A2 = randomUUID();
const B1 = randomUUID();
const REVOKED = randomUUID();
const TOKEN_A1 = randomBytes(32).toString("base64url");
const TOKEN_B1 = randomBytes(32).toString("base64url");

const activeDevices = new Map<string, { id: string; userId: string }>([
  [A1, { id: A1, userId: UA }],
  [A2, { id: A2, userId: UA }],
  [B1, { id: B1, userId: UB }],
]);

const fakeAuth = {
  getActiveDevice: async (id: string) => activeDevices.get(id),
  getAuthenticatedActor: async (headers: SessionHeaders): Promise<Actor | undefined> => {
    if (headers.authorization === `Bearer ${TOKEN_A1}`) {
      return { id: A1, userId: UA, sessionId: randomUUID(), tokenHash: Buffer.alloc(0) };
    }
    if (headers.authorization === `Bearer ${TOKEN_B1}`) {
      return { id: B1, userId: UB, sessionId: randomUUID(), tokenHash: Buffer.alloc(0) };
    }
    return undefined;
  },
};

const actorOf = (id: string, userId: string): Actor => ({
  id,
  userId,
  sessionId: randomUUID(),
  tokenHash: Buffer.alloc(0),
});
const callerA1 = actorOf(A1, UA);
const calleeA2 = actorOf(A2, UA);
const strangerB1 = actorOf(B1, UB);
const revokedDevice = actorOf(REVOKED, UA);

/** Builds a client event that is valid at NOW unless overridden. */
function event(type: string, callId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: randomUUID(),
    type,
    callId,
    sentAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 30_000).toISOString(),
    payload: {},
    ...overrides,
  };
}

/** A socket double that records every event the server emits to it. */
interface FakeSocket extends SignalingSocket {
  emit: Mock<(event: string, data: unknown) => boolean>;
  disconnect: Mock<(close?: boolean) => unknown>;
}

function fakeClient(handshake: { headers?: Record<string, string>; auth?: Record<string, unknown> } = {}): FakeSocket {
  return {
    connected: true,
    handshake: { headers: handshake.headers ?? {}, auth: handshake.auth ?? {} },
    emit: vi.fn<(event: string, data: unknown) => boolean>(() => true),
    disconnect: vi.fn<(close?: boolean) => unknown>(),
  };
}

/** Bodies of the signal events a client has received, in order. */
function framesOf(client: FakeSocket): unknown[] {
  return client.emit.mock.calls.filter(([event]) => event === SIGNAL_EVENT).map(([, data]) => data);
}

async function setup() {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SignalingService,
      SignalingGateway,
      ConnectionRegistry,
      CallRegistry,
      ReplayGuard,
      { provide: AuthService, useValue: fakeAuth },
    ],
  }).compile();
  return {
    service: moduleRef.get(SignalingService),
    gateway: moduleRef.get(SignalingGateway),
    connections: moduleRef.get(ConnectionRegistry),
  };
}

/** Sets up a ringing call from A1 to A2 with both sockets online. */
async function ringingCall(service: SignalingService, connections: ConnectionRegistry) {
  const callA1 = fakeClient();
  const callA2 = fakeClient();
  connections.add(A1, callA1);
  connections.add(A2, callA2);
  const callId = randomUUID();
  const reply = await service.handle(callerA1, event("call.invite", callId, { to: A2 }), NOW);
  expect(reply).toMatchObject({ type: "signal.delivered" });
  callA1.emit.mockClear();
  callA2.emit.mockClear();
  return { callId, callA1, callA2 };
}

describe("validateEnvelope", () => {
  it("accepts a well-formed invite", () => {
    const result = validateEnvelope(event("call.invite", randomUUID(), { to: A2 }), NOW);
    expect(result.ok).toBe(true);
  });

  it("rejects an event larger than the byte limit", () => {
    const raw = event("rtc.offer", randomUUID(), { payload: { sdp: "x".repeat(MAX_EVENT_BYTES) } });
    expect(validateEnvelope(raw, NOW)).toMatchObject({ ok: false, code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects a missing event as invalid, not as too large", () => {
    expect(validateEnvelope(undefined, NOW)).toMatchObject({ ok: false, code: "INVALID_EVENT" });
  });

  it("rejects an unsupported protocol version", () => {
    expect(validateEnvelope(event("call.end", randomUUID(), { v: 2 }), NOW)).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_VERSION",
    });
  });

  it.each([
    ["an unknown event type", { type: "call.explode" }],
    ["an unknown top-level field", { extra: true }],
    ["a non-UUID event id", { id: "not-a-uuid" }],
    ["a non-UUID call id", { callId: "not-a-uuid" }],
    ["an unparseable timestamp", { sentAt: "yesterday" }],
    ["an already expired event", { expiresAt: new Date(NOW - 1).toISOString() }],
    ["a lifetime beyond sixty seconds", { expiresAt: new Date(NOW + 61_000).toISOString() }],
    ["a sentAt far in the future", { sentAt: new Date(NOW + 60_000).toISOString() }],
    ["a payload key the event does not allow", { payload: { sdp: "v=0", extra: 1 } }],
    ["an offer without sdp", { type: "rtc.offer", payload: {} }],
    ["an ICE candidate with a bad line index", { type: "rtc.ice_candidate", payload: { candidate: "c", sdpMLineIndex: 999 } }],
    ["a recipient that is not a UUID", { to: "someone" }],
  ])("rejects %s", (_label, overrides) => {
    const result = validateEnvelope(event("call.end", randomUUID(), overrides), NOW);
    expect(result.ok).toBe(false);
  });
});

describe("handshake authentication", () => {
  it("reads a bearer token from the Authorization header", () => {
    const handshake = { headers: { authorization: `Bearer ${TOKEN_A1}` }, auth: {} };
    expect(handshakeHeaders(handshake)).toEqual({ authorization: `Bearer ${TOKEN_A1}` });
  });

  it("reads a bearer token from the handshake auth field for browsers", () => {
    const handshake = { headers: {}, auth: { token: TOKEN_B1 } };
    expect(handshakeHeaders(handshake)).toEqual({ authorization: `Bearer ${TOKEN_B1}` });
  });

  it("disconnects a socket that presents no valid session", async () => {
    const { gateway, connections } = await setup();
    const client = fakeClient();

    await gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(framesOf(client)).toEqual([expect.objectContaining({ type: "signal.error", code: "NOT_AUTHENTICATED" })]);
    expect(connections.isOnline(A1)).toBe(false);
  });

  it("registers an authenticated socket, sends signal.ready and forgets it on disconnect", async () => {
    const { gateway, connections } = await setup();
    const client = fakeClient({ headers: { authorization: `Bearer ${TOKEN_A1}` } });

    await gateway.handleConnection(client);

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(connections.isOnline(A1)).toBe(true);
    expect(framesOf(client)).toEqual([{ type: "signal.ready" }]);

    gateway.handleDisconnect(client);
    expect(connections.isOnline(A1)).toBe(false);
  });

  it("refuses events from a socket that never authenticated", async () => {
    const { gateway } = await setup();
    const client = fakeClient();

    await gateway.onSignal(client, event("call.invite", randomUUID(), { to: A2 }));

    expect(framesOf(client)).toEqual([expect.objectContaining({ type: "signal.error", code: "NOT_AUTHENTICATED" })]);
  });

  it("limits a connection to thirty events per minute", async () => {
    const { gateway } = await setup();
    const client = fakeClient({ auth: { token: TOKEN_A1 } });
    await gateway.handleConnection(client);

    for (let index = 0; index < RATE_LIMIT_EVENTS; index += 1) {
      await gateway.onSignal(client, { not: "an event" });
    }
    await gateway.onSignal(client, { not: "an event" });

    const frames = framesOf(client).slice(1);
    expect(frames).toHaveLength(RATE_LIMIT_EVENTS + 1);
    expect(frames.at(-1)).toMatchObject({ type: "signal.error", code: "RATE_LIMITED" });
    expect(frames[0]).toMatchObject({ type: "signal.error", code: "INVALID_EVENT" });
  });

  it("shares the thirty-event budget across all sockets of one device", async () => {
    const { gateway } = await setup();
    const first = fakeClient({ auth: { token: TOKEN_A1 } });
    const second = fakeClient({ auth: { token: TOKEN_A1 } });
    await gateway.handleConnection(first);
    await gateway.handleConnection(second);

    for (let index = 0; index < RATE_LIMIT_EVENTS; index += 1) {
      await gateway.onSignal(index % 2 === 0 ? first : second, { not: "an event" });
    }
    await gateway.onSignal(second, { not: "an event" });

    expect(framesOf(second).at(-1)).toMatchObject({ type: "signal.error", code: "RATE_LIMITED" });
  });

  it("refuses a socket beyond the device cap and never registers it", async () => {
    const { gateway } = await setup();
    for (let index = 0; index < MAX_SOCKETS_PER_DEVICE; index += 1) {
      await gateway.handleConnection(fakeClient({ auth: { token: TOKEN_A1 } }));
    }
    const extra = fakeClient({ auth: { token: TOKEN_A1 } });

    await gateway.handleConnection(extra);
    await gateway.onSignal(extra, event("call.end", randomUUID()));

    expect(extra.disconnect).toHaveBeenCalledWith(true);
    expect(framesOf(extra)).toMatchObject([
      { type: "signal.error", code: "CAPACITY_EXCEEDED" },
      { type: "signal.error", code: "NOT_AUTHENTICATED" },
    ]);
  });
});

describe("authorization and relay", () => {
  let service: SignalingService;
  let connections: ConnectionRegistry;

  beforeEach(async () => {
    ({ service, connections } = await setup());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("relays the whole call from invite to end to the authenticated counterpart only", async () => {
    const callA1 = fakeClient();
    const callA2 = fakeClient();
    connections.add(A1, callA1);
    connections.add(A2, callA2);
    const callId = randomUUID();

    const invite = event("call.invite", callId, { to: A2, payload: { mode: "audio" } });
    expect(await service.handle(callerA1, invite, NOW)).toEqual({
      type: "signal.delivered",
      eventId: invite.id,
      callId,
    });
    expect(framesOf(callA2)).toEqual([expect.objectContaining({ type: "call.invite", from: A1, to: A2, callId })]);

    const accept = event("call.accept", callId);
    expect(await service.handle(calleeA2, accept, NOW)).toMatchObject({ type: "signal.delivered" });
    const offer = event("rtc.offer", callId, { payload: { sdp: "v=0 offer" } });
    expect(await service.handle(callerA1, offer, NOW)).toMatchObject({ type: "signal.delivered" });
    const answer = event("rtc.answer", callId, { payload: { sdp: "v=0 answer" } });
    expect(await service.handle(calleeA2, answer, NOW)).toMatchObject({ type: "signal.delivered" });
    const candidate = event("rtc.ice_candidate", callId, { payload: { candidate: "candidate:1 1 udp" } });
    expect(await service.handle(callerA1, candidate, NOW)).toMatchObject({ type: "signal.delivered" });

    const end = event("call.end", callId);
    expect(await service.handle(calleeA2, end, NOW)).toMatchObject({ type: "signal.delivered" });

    expect(framesOf(callA1)).toMatchObject([
      { type: "call.accept", from: A2, to: A1 },
      { type: "rtc.answer", from: A2, to: A1 },
      { type: "call.end", from: A2, to: A1 },
    ]);
    expect(framesOf(callA2)).toMatchObject([
      { type: "call.invite", from: A1, to: A2 },
      { type: "rtc.offer", from: A1, to: A2 },
      { type: "rtc.ice_candidate", from: A1, to: A2 },
    ]);
  });

  it("refuses an invite to a device of another user", async () => {
    const callB1 = fakeClient();
    connections.add(B1, callB1);

    const reply = await service.handle(callerA1, event("call.invite", randomUUID(), { to: B1 }), NOW);

    expect(reply).toMatchObject({ type: "signal.error", code: "RECIPIENT_NOT_ALLOWED" });
    expect(callB1.emit).not.toHaveBeenCalled();
  });

  it("refuses an invite to an unknown or revoked device with the same error as another user", async () => {
    const reply = await service.handle(callerA1, event("call.invite", randomUUID(), { to: REVOKED }), NOW);
    expect(reply).toMatchObject({ type: "signal.error", code: "RECIPIENT_NOT_ALLOWED" });
  });

  it("refuses events from a revoked sender device", async () => {
    const reply = await service.handle(revokedDevice, event("call.invite", randomUUID(), { to: A2 }), NOW);
    expect(reply).toMatchObject({ type: "signal.error", code: "NOT_AUTHENTICATED" });
  });

  it("answers an invite to an offline device with signal.offline and creates no call", async () => {
    const callId = randomUUID();

    const reply = await service.handle(callerA1, event("call.invite", callId, { to: A2 }), NOW);

    expect(reply).toEqual(expect.objectContaining({ type: "signal.offline", callId }));
    expect(await service.handle(calleeA2, event("call.accept", callId), NOW)).toMatchObject({
      type: "signal.error",
      code: "NOT_FOUND",
    });
  });

  it("lets only the callee accept and only the caller send an offer", async () => {
    const { callId, callA2 } = await ringingCall(service, connections);
    callA2.emit.mockClear();

    expect(await service.handle(callerA1, event("call.accept", callId), NOW)).toMatchObject({
      type: "signal.error",
      code: "FORBIDDEN",
    });

    await service.handle(calleeA2, event("call.accept", callId), NOW);
    expect(await service.handle(calleeA2, event("rtc.offer", callId, { payload: { sdp: "v=0" } }), NOW)).toMatchObject({
      type: "signal.error",
      code: "FORBIDDEN",
    });
  });

  it("refuses media events before the call is accepted", async () => {
    const { callId } = await ringingCall(service, connections);

    expect(
      await service.handle(callerA1, event("rtc.offer", callId, { payload: { sdp: "v=0" } }), NOW),
    ).toMatchObject({ type: "signal.error", code: "INVALID_STATE" });
  });

  it("ignores a client-supplied recipient on relayed events and uses the call state", async () => {
    const { callId, callA2 } = await ringingCall(service, connections);
    const callB1 = fakeClient();
    connections.add(B1, callB1);
    await service.handle(calleeA2, event("call.accept", callId), NOW);
    callA2.emit.mockClear();

    const offer = event("rtc.offer", callId, { to: B1, payload: { sdp: "v=0" } });
    expect(await service.handle(callerA1, offer, NOW)).toMatchObject({ type: "signal.delivered" });

    expect(callB1.emit).not.toHaveBeenCalled();
    expect(framesOf(callA2)).toEqual([expect.objectContaining({ type: "rtc.offer", from: A1, to: A2 })]);
  });

  it("refuses an event from a device that is not part of the call", async () => {
    const { callId } = await ringingCall(service, connections);
    expect(await service.handle(strangerB1, event("call.cancel", callId), NOW)).toMatchObject({
      type: "signal.error",
      code: "FORBIDDEN",
    });
  });

  it("rejects an event for a call that does not exist", async () => {
    expect(await service.handle(callerA1, event("call.cancel", randomUUID()), NOW)).toMatchObject({
      type: "signal.error",
      code: "NOT_FOUND",
    });
  });

  it("refuses a second invite with the same call id", async () => {
    const { callId } = await ringingCall(service, connections);
    expect(await service.handle(callerA1, event("call.invite", callId, { to: A2 }), NOW)).toMatchObject({
      type: "signal.error",
      code: "CONFLICT",
    });
  });

  it("forgets a call once it is rejected", async () => {
    const { callId, callA2 } = await ringingCall(service, connections);
    expect(await service.handle(calleeA2, event("call.reject", callId), NOW)).toMatchObject({
      type: "signal.delivered",
    });
    callA2.emit.mockClear();
    expect(await service.handle(callerA1, event("call.cancel", callId), NOW)).toMatchObject({
      type: "signal.error",
      code: "NOT_FOUND",
    });
  });

  it.each([
    ["call.cancel", "caller", false],
    ["call.reject", "callee", false],
    ["call.end", "caller", true],
  ])("ends the call on %s when the counterpart is offline, and still reports signal.offline", async (type, sender, accepted) => {
    const { callId, callA1, callA2 } = await ringingCall(service, connections);
    if (accepted) {
      await service.handle(calleeA2, event("call.accept", callId), NOW);
    }
    const fromCaller = sender === "caller";
    connections.remove(fromCaller ? A2 : A1, fromCaller ? callA2 : callA1);
    const actor = fromCaller ? callerA1 : calleeA2;

    expect(await service.handle(actor, event(type, callId), NOW)).toMatchObject({ type: "signal.offline", callId });
    expect(await service.handle(actor, event(type, callId), NOW)).toMatchObject({
      type: "signal.error",
      code: "NOT_FOUND",
    });
  });

  it("does not extend a ringing call when the session reconnects", async () => {
    const { callId } = await ringingCall(service, connections);
    const reconnect = event("session.reconnect", callId, {
      sentAt: new Date(NOW + 30_000).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
    });
    expect(await service.handle(callerA1, reconnect, NOW + 30_000)).toMatchObject({ type: "signal.delivered" });

    const accept = event("call.accept", callId, {
      sentAt: new Date(NOW + 61_000).toISOString(),
      expiresAt: new Date(NOW + 90_000).toISOString(),
    });
    expect(await service.handle(calleeA2, accept, NOW + 61_000)).toMatchObject({
      type: "signal.error",
      code: "NOT_FOUND",
    });
  });
});

describe("validation, size and replay at the service", () => {
  let service: SignalingService;
  let connections: ConnectionRegistry;

  beforeEach(async () => {
    ({ service, connections } = await setup());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not let unauthorized events use up the replay guard", async () => {
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const { callId } = await ringingCall(service, connections);
    for (let index = 0; index < REPLAY_GUARD_CAPACITY; index += 1) {
      await service.handle(strangerB1, event("call.cancel", callId), NOW);
    }

    expect(await service.handle(calleeA2, event("call.accept", callId), NOW)).toMatchObject({
      type: "signal.delivered",
    });
  });

  it("refuses an oversized event without relaying it", async () => {
    const { callId, callA2 } = await ringingCall(service, connections);
    await service.handle(calleeA2, event("call.accept", callId), NOW);
    callA2.emit.mockClear();

    const oversized = event("rtc.offer", callId, { payload: { sdp: "x".repeat(MAX_EVENT_BYTES) } });
    expect(await service.handle(callerA1, oversized, NOW)).toMatchObject({
      type: "signal.error",
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(callA2.emit).not.toHaveBeenCalled();
  });

  it("drops a duplicate of an event already relayed", async () => {
    const { callId, callA2 } = await ringingCall(service, connections);
    const accept = event("call.accept", callId);
    expect(await service.handle(calleeA2, accept, NOW)).toMatchObject({ type: "signal.delivered" });
    callA2.emit.mockClear();

    expect(await service.handle(calleeA2, accept, NOW)).toMatchObject({
      type: "signal.error",
      code: "DUPLICATE_EVENT",
    });
    expect(callA2.emit).not.toHaveBeenCalled();
  });

  it("refuses an event whose lifetime has ended", async () => {
    const { callId } = await ringingCall(service, connections);
    const stale = event("call.cancel", callId);
    expect(await service.handle(callerA1, stale, NOW + 31_000)).toMatchObject({
      type: "signal.error",
      code: "INVALID_EVENT",
    });
  });

  it("does not log SDP, candidates or other payload content", async () => {
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const { callId } = await ringingCall(service, connections);
    await service.handle(calleeA2, event("call.accept", callId), NOW);
    await service.handle(callerA1, event("rtc.offer", callId, { payload: { sdp: "SECRET-SDP-BODY" } }), NOW);

    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain("SECRET-SDP-BODY");
    expect(JSON.stringify(logged)).toContain(callId);
  });
});

describe("bounded in-memory state", () => {
  it("limits a connection to thirty events in a sliding minute", () => {
    const limiter = new ConnectionRateLimiter();
    for (let index = 0; index < RATE_LIMIT_EVENTS; index += 1) {
      expect(limiter.take(NOW)).toBe(true);
    }
    expect(limiter.take(NOW)).toBe(false);
    expect(limiter.take(NOW + 60_001)).toBe(true);
  });

  it("refuses a replayed event id within its retention and admits it after", () => {
    const guard = new ReplayGuard();
    const eventId = randomUUID();
    const callId = randomUUID();

    expect(guard.record(callId, eventId, NOW)).toBe("accepted");
    expect(guard.record(callId, eventId, NOW + 1_000)).toBe("duplicate");
    expect(guard.record(randomUUID(), eventId, NOW + 1_000)).toBe("accepted");
    expect(guard.record(callId, eventId, NOW + 60_001)).toBe("accepted");
  });

  it("fails closed when the replay guard is full", () => {
    const guard = new ReplayGuard();
    const callId = randomUUID();
    for (let index = 0; index < REPLAY_GUARD_CAPACITY; index += 1) {
      expect(guard.record(callId, randomUUID(), NOW)).toBe("accepted");
    }
    expect(guard.record(callId, randomUUID(), NOW)).toBe("full");
    expect(guard.size).toBe(REPLAY_GUARD_CAPACITY);
  });

  it("drops a ringing call that nobody answers within a minute", () => {
    const calls = new CallRegistry();
    const callId = randomUUID();
    expect(calls.start(callId, A1, A2, NOW)).toBe(true);
    expect(calls.get(callId, NOW + 59_000)).toBeDefined();
    expect(calls.get(callId, NOW + 61_000)).toBeUndefined();
  });

  it("caps the sockets one device may hold open", () => {
    const registry = new ConnectionRegistry();
    for (let index = 0; index < MAX_SOCKETS_PER_DEVICE; index += 1) {
      expect(registry.add(A1, fakeClient())).toBe(true);
    }
    expect(registry.add(A1, fakeClient())).toBe(false);
    expect(registry.socketCount(A1)).toBe(MAX_SOCKETS_PER_DEVICE);
  });
});
