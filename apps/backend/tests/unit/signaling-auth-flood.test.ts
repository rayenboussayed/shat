import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { AuthService } from "../../src/identity/auth.service.ts";
import type { Actor, SessionHeaders } from "../../src/identity/schemas.ts";
import { CallRegistry } from "../../src/signaling/call-state.ts";
import { ConnectionRegistry } from "../../src/signaling/connections.ts";
import {
  FailedAuthLimiter,
  MAX_FAILED_AUTH_ATTEMPTS,
  MAX_PRE_AUTH_CONNECTIONS,
  ReplayGuard,
} from "../../src/signaling/guards.ts";
import { SIGNAL_EVENT } from "../../src/signaling/schemas.ts";
import { SignalingGateway } from "../../src/signaling/signaling.gateway.ts";
import type { SignalingSocket } from "../../src/signaling/signaling.gateway.ts";
import { SignalingService } from "../../src/signaling/signaling.service.ts";

const TOKEN = randomBytes(32).toString("base64url");
const DEVICE = randomUUID();
const USER = randomUUID();

const auth = {
  getActiveDevice: async (id: string) => (id === DEVICE ? { id, userId: USER } : undefined),
  getAuthenticatedActor: async (headers: SessionHeaders): Promise<Actor | undefined> =>
    headers.authorization === `Bearer ${TOKEN}`
      ? { id: DEVICE, userId: USER, sessionId: randomUUID(), tokenHash: Buffer.alloc(0) }
      : undefined,
};

interface FakeSocket extends SignalingSocket {
  emit: Mock<(event: string, data: unknown) => boolean>;
  disconnect: Mock<(close?: boolean) => unknown>;
}

function fakeClient(authFields: Record<string, unknown> = {}, address?: string): FakeSocket {
  return {
    connected: true,
    handshake: { headers: {}, auth: authFields, ...(address === undefined ? {} : { address }) },
    emit: vi.fn<(event: string, data: unknown) => boolean>(() => true),
    disconnect: vi.fn<(close?: boolean) => unknown>(),
  };
}

async function setup(): Promise<SignalingGateway> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SignalingService,
      SignalingGateway,
      ConnectionRegistry,
      CallRegistry,
      ReplayGuard,
      { provide: AuthService, useValue: auth },
    ],
  }).compile();
  return moduleRef.get(SignalingGateway);
}

describe("failed authentication limiter", () => {
  it("caps failures within a window and recovers once they age out", () => {
    const limiter = new FailedAuthLimiter();
    const now = 1_000_000;
    for (let index = 0; index < MAX_FAILED_AUTH_ATTEMPTS; index += 1) {
      expect(limiter.isFull(now)).toBe(false);
      limiter.record(now);
    }
    expect(limiter.isFull(now)).toBe(true);
    expect(limiter.isFull(now + 10_001)).toBe(false);
  });
});

describe("signaling connect flood", () => {
  it("refuses handshakes without a database lookup after repeated failed authentications", async () => {
    const gateway = await setup();
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const lookup = vi.spyOn(auth, "getAuthenticatedActor");
    try {
      for (let index = 0; index < MAX_FAILED_AUTH_ATTEMPTS; index += 1) {
        await gateway.handleConnection(fakeClient());
      }
      const lookupsAfterFlood = lookup.mock.calls.length;
      const valid = fakeClient({ token: TOKEN });

      await gateway.handleConnection(valid);

      expect(lookup.mock.calls.length).toBe(lookupsAfterFlood);
      expect(valid.disconnect).toHaveBeenCalledWith(true);
      expect(valid.emit).toHaveBeenCalledWith(SIGNAL_EVENT, {
        type: "signal.error",
        code: "RATE_LIMITED",
        message: "Too many authentication attempts",
      });
    } finally {
      log.mockRestore();
      lookup.mockRestore();
    }
  });

  it("keeps one source's failed-auth flood from blocking another source", async () => {
    const gateway = await setup();
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const lookup = vi.spyOn(auth, "getAuthenticatedActor");
    try {
      for (let index = 0; index < MAX_FAILED_AUTH_ATTEMPTS; index += 1) {
        await gateway.handleConnection(fakeClient({}, "203.0.113.1"));
      }
      const lookupsAfterFlood = lookup.mock.calls.length;
      const otherSource = fakeClient({ token: TOKEN }, "203.0.113.2");

      await gateway.handleConnection(otherSource);

      expect(lookup.mock.calls.length).toBe(lookupsAfterFlood + 1);
      expect(otherSource.disconnect).not.toHaveBeenCalled();
      expect(otherSource.emit).toHaveBeenCalledWith(SIGNAL_EVENT, { type: "signal.ready" });
    } finally {
      log.mockRestore();
      lookup.mockRestore();
    }
  });

  it("caps pre-auth connection attempts per source before the database lookup", async () => {
    const gateway = await setup();
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const lookup = vi.spyOn(auth, "getAuthenticatedActor");
    try {
      for (let index = 0; index < MAX_PRE_AUTH_CONNECTIONS; index += 1) {
        await gateway.handleConnection(fakeClient({ token: TOKEN }, "198.51.100.9"));
      }
      const lookupsAtCap = lookup.mock.calls.length;
      expect(lookupsAtCap).toBe(MAX_PRE_AUTH_CONNECTIONS);
      const extra = fakeClient({ token: TOKEN }, "198.51.100.9");

      await gateway.handleConnection(extra);

      expect(lookup.mock.calls.length).toBe(lookupsAtCap);
      expect(extra.emit).toHaveBeenCalledWith(SIGNAL_EVENT, {
        type: "signal.error",
        code: "RATE_LIMITED",
        message: "Too many connection attempts",
      });
    } finally {
      log.mockRestore();
      lookup.mockRestore();
    }
  });
});
