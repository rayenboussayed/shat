import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import {
  deviceIdentityKeys,
  devices,
  oneTimePrekeys,
  sessions,
  signedPrekeys,
} from "../db/db.ts";
import { AuthService } from "./auth.service.ts";
import type {
  ClaimedPrekey,
  DeviceQuery,
  PrekeyBody,
  OneTimePrekeyBody,
  SessionHeaders,
  IdentityResult,
} from "./schemas.ts";

const publicError = (statusCode: number) => {
  const map: Record<number, { error: string; message: string }> = {
    401: { error: "Unauthorized", message: "Authentication is required" },
    403: { error: "Forbidden", message: "The request is not permitted" },
    404: { error: "Not Found", message: "The requested resource was not found" },
  };
  return { statusCode, ...map[statusCode] };
};

/** Signed and one-time prekey publishing, claiming and lookup. */
@Injectable()
export class PrekeyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  /** Publishes or replaces a device's signed prekey. */
  async publishSignedPrekey(
    headers: SessionHeaders,
    body: PrekeyBody,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const publicKey = this.auth.decodeBase64(body.publicKey, 32);
    const signature = this.auth.decodeBase64(body.signature, 64);
    const expiresAt = new Date(body.expiresAt);
    if (!publicKey || !signature || expiresAt <= new Date()) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "The signed prekey is invalid" },
      };
    }

    const id = randomUUID();
    const now = new Date();
    const db = this.database.db;
    const result = await db.transaction(async (transaction) => {
      const [activeActor] = await transaction
        .select({ id: devices.id })
        .from(sessions)
        .innerJoin(devices, eq(sessions.deviceId, devices.id))
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(sessions.tokenHash, actor.tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      if (!activeActor) {
        return undefined;
      }

      const [prekey] = await transaction
        .insert(signedPrekeys)
        .values({
          id,
          deviceId: actor.id,
          keyId: body.keyId,
          publicKey,
          signature,
          expiresAt,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: signedPrekeys.deviceId,
          set: {
            keyId: body.keyId,
            publicKey,
            signature,
            expiresAt,
            createdAt: now,
          },
        })
        .returning({ id: signedPrekeys.id });
      return prekey;
    });
    if (!result) {
      return { status: 401, body: publicError(401) };
    }

    return { status: 201, body: { id: result.id, deviceId: actor.id, keyId: body.keyId } };
  }

  /** Publishes a batch of one-time prekeys. */
  async publishOneTimePrekeys(
    headers: SessionHeaders,
    body: OneTimePrekeyBody,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const prekeys: { keyId: number; publicKey: Buffer }[] = [];
    for (const prekey of body.prekeys) {
      const publicKey = this.auth.decodeBase64(prekey.publicKey, 32);
      if (!publicKey) {
        return {
          status: 400,
          body: { statusCode: 400, error: "Bad Request", message: "A one-time prekey is invalid" },
        };
      }
      prekeys.push({ keyId: prekey.keyId, publicKey });
    }

    const now = new Date();
    const db = this.database.db;
    const result = await db.transaction(async (transaction) => {
      const [activeActor] = await transaction
        .select({ id: devices.id })
        .from(sessions)
        .innerJoin(devices, eq(sessions.deviceId, devices.id))
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(sessions.tokenHash, actor.tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1);
      if (!activeActor) {
        return undefined;
      }

      return transaction
        .insert(oneTimePrekeys)
        .values(
          prekeys.map((prekey) => ({
            id: randomUUID(),
            deviceId: actor.id,
            keyId: prekey.keyId,
            publicKey: prekey.publicKey,
            createdAt: now,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: oneTimePrekeys.id });
    });
    if (!result) {
      return { status: 401, body: publicError(401) };
    }

    return { status: 201, body: { deviceId: actor.id, published: result.length } };
  }

  /** Claims a single one-time prekey atomically. */
  async claimOneTimePrekey(
    headers: SessionHeaders,
    body: DeviceQuery,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const db = this.database.db;
    const result = await db.transaction(async (transaction) => {
      const [actorSession] = await transaction
        .select({
          revokedAt: sessions.revokedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, actor.sessionId),
            eq(sessions.tokenHash, actor.tokenHash),
            eq(sessions.deviceId, actor.id),
          ),
        )
        .limit(1)
        .for("update");
      if (!actorSession || actorSession.revokedAt || actorSession.expiresAt <= new Date()) {
        return { kind: "unauthorized" } as const;
      }

      const lockedDevices = await transaction
        .select({ id: devices.id, userId: devices.userId, revokedAt: devices.revokedAt })
        .from(devices)
        .where(inArray(devices.id, [actor.id, body.deviceId]))
        .orderBy(asc(devices.id))
        .for("update");
      const actorDevice = lockedDevices.find((device) => device.id === actor.id);
      if (!actorDevice || actorDevice.revokedAt) {
        return { kind: "unauthorized" } as const;
      }

      const target = lockedDevices.find((device) => device.id === body.deviceId);
      if (!target || target.revokedAt) {
        return { kind: "not-found" } as const;
      }
      if (target.userId !== actorDevice.userId) {
        return { kind: "forbidden" } as const;
      }

      const claim = await transaction.execute<ClaimedPrekey>(sql`
        UPDATE one_time_prekeys
        SET claimed_at = now(), claim_receipt_id = gen_random_uuid()
        WHERE id = (
          SELECT id
          FROM one_time_prekeys
          WHERE device_id = ${body.deviceId} AND claimed_at IS NULL
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, device_id, key_id, public_key, created_at, claimed_at, claim_receipt_id
      `);
      const prekey = claim.rows[0];
      return prekey ? { kind: "claimed", prekey } as const : { kind: "empty" } as const;
    });

    if (result.kind === "unauthorized") {
      return { status: 401, body: publicError(401) };
    }
    if (result.kind === "forbidden") {
      return { status: 403, body: publicError(403) };
    }
    if (result.kind === "not-found" || result.kind === "empty") {
      return { status: 404, body: publicError(404) };
    }

    const prekey = result.prekey;
    return {
      status: 200,
      body: {
        id: prekey.id,
        deviceId: prekey.device_id,
        keyId: prekey.key_id,
        publicKey: prekey.public_key.toString("base64"),
        createdAt: prekey.created_at,
        claimedAt: prekey.claimed_at,
        claimReceiptId: prekey.claim_receipt_id,
      },
    };
  }

  /** Returns the latest unexpired signed prekey for a device. */
  async getSignedPrekey(
    headers: SessionHeaders,
    query: DeviceQuery,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    if (!(await this.auth.getActiveDevice(query.deviceId))) {
      return { status: 404, body: publicError(404) };
    }

    const db = this.database.db;
    const [prekey] = await db
      .select({
        id: signedPrekeys.id,
        deviceId: signedPrekeys.deviceId,
        keyId: signedPrekeys.keyId,
        publicKey: signedPrekeys.publicKey,
        signature: signedPrekeys.signature,
        expiresAt: signedPrekeys.expiresAt,
        createdAt: signedPrekeys.createdAt,
        identityPublicKey: deviceIdentityKeys.publicKey,
        algorithm: deviceIdentityKeys.algorithm,
      })
      .from(signedPrekeys)
      .innerJoin(deviceIdentityKeys, eq(signedPrekeys.deviceId, deviceIdentityKeys.deviceId))
      .where(and(eq(signedPrekeys.deviceId, query.deviceId), sql`${signedPrekeys.expiresAt} > now()`))
      .orderBy(desc(signedPrekeys.createdAt))
      .limit(1);
    if (!prekey) {
      return { status: 404, body: publicError(404) };
    }

    return {
      status: 200,
      body: {
        signedPrekey: {
          id: prekey.id,
          deviceId: prekey.deviceId,
          keyId: prekey.keyId,
          publicKey: Buffer.from(prekey.publicKey).toString("base64"),
          signature: Buffer.from(prekey.signature).toString("base64"),
          expiresAt: prekey.expiresAt,
          createdAt: prekey.createdAt,
          identityKey: {
            publicKey: Buffer.from(prekey.identityPublicKey).toString("base64"),
            algorithm: prekey.algorithm,
          },
        },
      },
    };
  }
}