import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { DatabaseService } from "../../src/db/db.ts";
import { AuthService } from "../../src/identity/auth.service.ts";
import { PrekeyService } from "../../src/identity/prekey.service.ts";
import type { Actor, SessionHeaders, ClaimedPrekey } from "../../src/identity/schemas.ts";

const USER_A = randomUUID();
const USER_B = randomUUID();
const ACTOR_DEVICE = randomUUID();
const TARGET_DEVICE = randomUUID();
const headers: SessionHeaders = { authorization: "Bearer token" };
const actor: Actor = {
  id: ACTOR_DEVICE,
  userId: USER_A,
  sessionId: randomUUID(),
  tokenHash: Buffer.alloc(0),
};

interface DeviceRow {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

/** Builds a PrekeyService whose transaction returns the supplied locked rows and claim. */
async function serviceFor(rows: DeviceRow[], claimed: ClaimedPrekey[]): Promise<PrekeyService> {
  const actorSession = { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ for: async () => [actorSession] }),
          orderBy: () => ({ for: async () => rows }),
        }),
      }),
    }),
    execute: async () => ({ rows: claimed }),
  };
  const database = {
    db: {
      transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
  const auth = { getAuthenticatedActor: async () => actor };
  const moduleRef = await Test.createTestingModule({
    providers: [
      PrekeyService,
      { provide: DatabaseService, useValue: database },
      { provide: AuthService, useValue: auth },
    ],
  }).compile();
  return moduleRef.get(PrekeyService);
}

/** A claim row in the shape returned by the atomic SQL update. */
function claimFor(deviceId: string): ClaimedPrekey {
  return {
    id: randomUUID(),
    device_id: deviceId,
    key_id: 7,
    public_key: Buffer.alloc(32, 3),
    created_at: new Date(),
    claimed_at: new Date(),
    claim_receipt_id: randomUUID(),
  };
}

describe("one-time prekey claim ownership", () => {
  it("forbids claiming a prekey for a device owned by another user", async () => {
    const service = await serviceFor(
      [
        { id: ACTOR_DEVICE, userId: USER_A, revokedAt: null },
        { id: TARGET_DEVICE, userId: USER_B, revokedAt: null },
      ],
      [],
    );

    const result = await service.claimOneTimePrekey(headers, { deviceId: TARGET_DEVICE });

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: "Forbidden", message: "The request is not permitted" });
  });

  it("still claims a prekey for a device owned by the same user", async () => {
    const service = await serviceFor(
      [
        { id: ACTOR_DEVICE, userId: USER_A, revokedAt: null },
        { id: TARGET_DEVICE, userId: USER_A, revokedAt: null },
      ],
      [claimFor(TARGET_DEVICE)],
    );

    const result = await service.claimOneTimePrekey(headers, { deviceId: TARGET_DEVICE });

    expect(result.status).toBe(200);
  });
});
