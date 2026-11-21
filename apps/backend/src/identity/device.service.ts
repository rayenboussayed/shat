import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import {
  devices,
  deviceIdentityKeys,
  pushEndpoints,
  sessions,
  users,
} from "../db/db.ts";
import { AuthService } from "./auth.service.ts";
import type {
  DeviceBody,
  DevicesQuery,
  DeviceParams,
  DeviceQuery,
  SessionHeaders,
  IdentityResult,
} from "./schemas.ts";
import { sessionDurationMs } from "./schemas.ts";

const publicError = (statusCode: number) => {
  const map: Record<number, { error: string; message: string }> = {
    401: { error: "Unauthorized", message: "Authentication is required" },
    403: { error: "Forbidden", message: "The request is not permitted" },
    404: { error: "Not Found", message: "The requested resource was not found" },
    409: { error: "Conflict", message: "The request conflicts with current state" },
    503: { error: "Service Unavailable", message: "The service is not configured" },
  };
  return { statusCode, ...map[statusCode] };
};

/** Device enrollment, listing, revocation and lookup. */
@Injectable()
export class DeviceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  /** Creates a device for the configured bootstrap account. */
  async createDevice(body: DeviceBody, headers: SessionHeaders): Promise<IdentityResult> {
    const enrollmentToken = process.env.SHAT_ENROLLMENT_TOKEN;
    const enrollmentUserId = process.env.SHAT_ENROLLMENT_USER_ID;
    if (!enrollmentToken || !enrollmentUserId) {
      return { status: 503, body: publicError(503) };
    }
    if (!this.auth.matchesSecret(headers["x-enrollment-token"] ?? "", enrollmentToken)) {
      return { status: 401, body: publicError(401) };
    }

    const { deviceId, userId, identityPublicKey, algorithm } = body;
    if (!this.auth.matchesUtf8(userId, enrollmentUserId)) {
      return { status: 403, body: publicError(403) };
    }
    if ((identityPublicKey === undefined) !== (algorithm === undefined)) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "Identity key fields must be supplied together" },
      };
    }

    const key =
      identityPublicKey === undefined ? undefined : this.auth.decodeBase64(identityPublicKey, 32);
    if (identityPublicKey !== undefined && !key) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "The identity key is invalid" },
      };
    }

    const sessionToken = this.auth.newSessionToken();
    const tokenHash = this.auth.hashToken(sessionToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionDurationMs);
    const db = this.database.db;

    const result = await db.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), eq(users.status, "active")))
        .limit(1);
      if (!user) {
        return "missing-user" as const;
      }

      const [device] = await transaction
        .insert(devices)
        .values({
          id: deviceId,
          userId,
          createdAt: now,
          lastSeenAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: devices.id });
      if (!device) {
        return "device-conflict" as const;
      }

      if (key && algorithm) {
        await transaction.insert(deviceIdentityKeys).values({
          deviceId,
          publicKey: key,
          algorithm,
          createdAt: now,
        });
      }

      await transaction.insert(sessions).values({
        id: randomUUID(),
        deviceId,
        tokenHash,
        createdAt: now,
        expiresAt,
        lastUsedAt: now,
        clientInfo: {},
      });

      return "created" as const;
    });

    if (result === "missing-user") {
      return { status: 404, body: publicError(404) };
    }
    if (result === "device-conflict") {
      return { status: 409, body: publicError(409) };
    }

    return {
      status: 201,
      body: {
        deviceId,
        userId,
        identityKey: key && algorithm ? { publicKey: key.toString("base64"), algorithm } : null,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /** Lists devices for the authenticated owner. */
  async listDevices(headers: SessionHeaders, query: DevicesQuery): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    if (actor.userId !== query.userId) {
      return { status: 403, body: publicError(403) };
    }

    const db = this.database.db;
    const result = await db
      .select({
        deviceId: devices.id,
        userId: devices.userId,
        createdAt: devices.createdAt,
        lastSeenAt: devices.lastSeenAt,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.userId, query.userId))
      .orderBy(devices.createdAt);

    return { status: 200, body: { devices: result } };
  }

  /** Revokes a device and its sessions/push endpoints. */
  async revokeDevice(headers: SessionHeaders, params: DeviceParams): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const now = new Date();
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
        .where(inArray(devices.id, [actor.id, params.deviceId]))
        .orderBy(asc(devices.id))
        .for("update");
      const actorDevice = lockedDevices.find((device) => device.id === actor.id);
      if (!actorDevice || actorDevice.revokedAt) {
        return { kind: "unauthorized" } as const;
      }

      const target = lockedDevices.find((device) => device.id === params.deviceId);
      if (!target) {
        return { kind: "not-found" } as const;
      }
      if (target.revokedAt) {
        return { kind: "conflict" } as const;
      }
      if (target.userId !== actorDevice.userId) {
        return { kind: "forbidden" } as const;
      }

      await transaction
        .update(devices)
        .set({ revokedAt: now })
        .where(and(eq(devices.id, target.id), isNull(devices.revokedAt)));
      await transaction
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.deviceId, target.id), isNull(sessions.revokedAt)));
      await transaction
        .update(pushEndpoints)
        .set({ disabledAt: now, updatedAt: now })
        .where(and(eq(pushEndpoints.deviceId, target.id), isNull(pushEndpoints.disabledAt)));

      return { kind: "revoked", deviceId: target.id } as const;
    });

    if (result.kind === "unauthorized") {
      return { status: 401, body: publicError(401) };
    }
    if (result.kind === "not-found") {
      return { status: 404, body: publicError(404) };
    }
    if (result.kind === "conflict") {
      return { status: 409, body: publicError(409) };
    }
    if (result.kind === "forbidden") {
      return { status: 403, body: publicError(403) };
    }

    return { status: 200, body: { deviceId: result.deviceId, revokedAt: now.toISOString() } };
  }

  /** Gets a single active device with its identity key. */
  async getDevice(headers: SessionHeaders, query: DeviceQuery): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const db = this.database.db;
    const [device] = await db
      .select({
        deviceId: devices.id,
        userId: devices.userId,
        createdAt: devices.createdAt,
        lastSeenAt: devices.lastSeenAt,
        identityPublicKey: deviceIdentityKeys.publicKey,
        algorithm: deviceIdentityKeys.algorithm,
      })
      .from(devices)
      .leftJoin(deviceIdentityKeys, eq(devices.id, deviceIdentityKeys.deviceId))
      .where(and(eq(devices.id, query.deviceId), isNull(devices.revokedAt)))
      .limit(1);
    if (!device) {
      return { status: 404, body: publicError(404) };
    }

    return {
      status: 200,
      body: {
        device: {
          deviceId: device.deviceId,
          userId: device.userId,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          identityKey: device.identityPublicKey
            ? { publicKey: Buffer.from(device.identityPublicKey).toString("base64"), algorithm: device.algorithm }
            : null,
        },
      },
    };
  }
}