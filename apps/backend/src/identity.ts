import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  db,
  deviceIdentityKeys,
  devices,
  oneTimePrekeys,
  pushEndpoints,
  sessions,
  signedPrekeys,
  users,
} from "./db/db.ts";

const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

const base64Schema = { type: "string", minLength: 4, maxLength: 8192 } as const;
const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;

const publicError = {
  401: { error: "Unauthorized", message: "Authentication is required" },
  403: { error: "Forbidden", message: "The request is not permitted" },
  404: { error: "Not Found", message: "The requested resource was not found" },
  409: { error: "Conflict", message: "The request conflicts with current state" },
  503: { error: "Service Unavailable", message: "The service is not configured" },
} as const;

interface DeviceParams {
  deviceId: string;
}

interface DeviceQuery {
  deviceId: string;
}

interface DevicesQuery {
  userId: string;
}

interface DeviceBody {
  deviceId: string;
  userId: string;
  identityPublicKey?: string;
  algorithm?: string;
}

interface PrekeyBody {
  keyId: number;
  publicKey: string;
  signature: string;
  expiresAt: string;
}

interface OneTimePrekeyBody {
  prekeys: { keyId: number; publicKey: string }[];
}

interface SessionHeaders {
  authorization?: string;
  "x-session-token"?: string;
  "x-enrollment-token"?: string;
}

interface Actor {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: Buffer;
}

type ClaimedPrekey = Record<string, unknown> & {
  id: string;
  device_id: string;
  key_id: number;
  public_key: Buffer;
  created_at: Date;
  claimed_at: Date;
  claim_receipt_id: string;
};

/**
 * Registers the identity, device, and prekey HTTP endpoints.
 */
export function registerIdentityRoutes(app: FastifyInstance): void {
  app.post<{ Body: DeviceBody; Headers: SessionHeaders }>(
    "/identity/devices",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            deviceId: uuidSchema,
            userId: uuidSchema,
            identityPublicKey: base64Schema,
            algorithm: { type: "string", minLength: 1, maxLength: 64 },
          },
          required: ["deviceId", "userId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => createDevice(request, reply),
  );

  app.get<{ Querystring: DevicesQuery; Headers: SessionHeaders }>(
    "/identity/devices",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { userId: uuidSchema },
          required: ["userId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => listDevices(request, reply),
  );

  app.post<{ Params: DeviceParams; Headers: SessionHeaders }>(
    "/identity/devices/:deviceId/revoke",
    {
      schema: {
        params: {
          type: "object",
          properties: { deviceId: uuidSchema },
          required: ["deviceId"],
        },
      },
    },
    async (request, reply) => revokeDevice(request, reply),
  );

  app.get<{ Querystring: DeviceQuery; Headers: SessionHeaders }>(
    "/identity/device",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { deviceId: uuidSchema },
          required: ["deviceId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => getDevice(request, reply),
  );

  app.post<{ Body: PrekeyBody; Headers: SessionHeaders }>(
    "/prekeys/publish",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            keyId: { type: "integer", minimum: 0, maximum: 2147483647 },
            publicKey: base64Schema,
            signature: base64Schema,
            expiresAt: { type: "string", format: "date-time" },
          },
          required: ["keyId", "publicKey", "signature", "expiresAt"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => publishSignedPrekey(request, reply),
  );

  app.post<{ Body: OneTimePrekeyBody; Headers: SessionHeaders }>(
    "/prekeys/one-time",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            prekeys: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                properties: {
                  keyId: { type: "integer", minimum: 0, maximum: 2147483647 },
                  publicKey: base64Schema,
                },
                required: ["keyId", "publicKey"],
                additionalProperties: false,
              },
            },
          },
          required: ["prekeys"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => publishOneTimePrekeys(request, reply),
  );

  app.post<{ Body: DeviceQuery; Headers: SessionHeaders }>(
    "/prekeys/claim",
    {
      schema: {
        body: {
          type: "object",
          properties: { deviceId: uuidSchema },
          required: ["deviceId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => claimOneTimePrekey(request, reply),
  );

  app.get<{ Querystring: DeviceQuery; Headers: SessionHeaders }>(
    "/prekeys/signed",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { deviceId: uuidSchema },
          required: ["deviceId"],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => getSignedPrekey(request, reply),
  );
}

/**
 * Creates a device for the configured bootstrap account. SHAT_ENROLLMENT_USER_ID
 * is the provisional enrollment ownership rule until account authentication lands.
 */
async function createDevice(
  request: FastifyRequest<{ Body: DeviceBody; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const enrollmentToken = process.env.SHAT_ENROLLMENT_TOKEN;
  const enrollmentUserId = process.env.SHAT_ENROLLMENT_USER_ID;
  if (!enrollmentToken || !enrollmentUserId) {
    return sendPublicError(reply, 503);
  }
  if (!matchesSecret(request.headers["x-enrollment-token"] ?? "", enrollmentToken)) {
    return sendPublicError(reply, 401);
  }

  const { deviceId, userId, identityPublicKey, algorithm } = request.body;
  if (!matchesUtf8(userId, enrollmentUserId)) {
    return sendPublicError(reply, 403);
  }
  if ((identityPublicKey === undefined) !== (algorithm === undefined)) {
    return reply.code(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: "Identity key fields must be supplied together",
    });
  }

  const key =
    identityPublicKey === undefined ? undefined : decodeBase64(identityPublicKey, 32);
  if (identityPublicKey !== undefined && !key) {
    return reply.code(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: "The identity key is invalid",
    });
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(sessionToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDurationMs);
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
    return sendPublicError(reply, 404);
  }
  if (result === "device-conflict") {
    return sendPublicError(reply, 409);
  }

  return reply.code(201).send({
    deviceId,
    userId,
    identityKey: key && algorithm ? { publicKey: key.toString("base64"), algorithm } : null,
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  });
}

async function listDevices(
  request: FastifyRequest<{ Querystring: DevicesQuery; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }
  if (actor.userId !== request.query.userId) {
    return sendPublicError(reply, 403);
  }

  const result = await db
    .select({
      deviceId: devices.id,
      userId: devices.userId,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .where(eq(devices.userId, request.query.userId))
    .orderBy(devices.createdAt);

  return { devices: result };
}

async function revokeDevice(
  request: FastifyRequest<{ Params: DeviceParams; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }

  const now = new Date();
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

    /** Canonical ordering avoids deadlocks when two devices revoke each other. */
    const lockedDevices = await transaction
      .select({ id: devices.id, userId: devices.userId, revokedAt: devices.revokedAt })
      .from(devices)
      .where(inArray(devices.id, [actor.id, request.params.deviceId]))
      .orderBy(asc(devices.id))
      .for("update");
    const actorDevice = lockedDevices.find((device) => device.id === actor.id);
    if (!actorDevice || actorDevice.revokedAt) {
      return { kind: "unauthorized" } as const;
    }

    const target = lockedDevices.find((device) => device.id === request.params.deviceId);
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
    return sendPublicError(reply, 401);
  }
  if (result.kind === "not-found") {
    return sendPublicError(reply, 404);
  }
  if (result.kind === "conflict") {
    return sendPublicError(reply, 409);
  }
  if (result.kind === "forbidden") {
    return sendPublicError(reply, 403);
  }

  return { deviceId: result.deviceId, revokedAt: now.toISOString() };
}

async function getDevice(
  request: FastifyRequest<{ Querystring: DeviceQuery; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }

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
    .where(and(eq(devices.id, request.query.deviceId), isNull(devices.revokedAt)))
    .limit(1);
  if (!device) {
    return sendPublicError(reply, 404);
  }

  return {
    device: {
      deviceId: device.deviceId,
      userId: device.userId,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      identityKey: device.identityPublicKey
        ? { publicKey: Buffer.from(device.identityPublicKey).toString("base64"), algorithm: device.algorithm }
        : null,
    },
  };
}

/**
 * Stores submitted signature bytes without verifying them. Clients verify signed-prekey
 * signatures through the reviewed crypto facade, as required by spec §5.8.
 */
async function publishSignedPrekey(
  request: FastifyRequest<{ Body: PrekeyBody; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }

  const publicKey = decodeBase64(request.body.publicKey, 32);
  const signature = decodeBase64(request.body.signature, 64);
  const expiresAt = new Date(request.body.expiresAt);
  if (!publicKey || !signature || expiresAt <= new Date()) {
    return reply.code(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: "The signed prekey is invalid",
    });
  }

  const id = randomUUID();
  const now = new Date();
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
        keyId: request.body.keyId,
        publicKey,
        signature,
        expiresAt,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: signedPrekeys.deviceId,
        set: {
          keyId: request.body.keyId,
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
    return sendPublicError(reply, 401);
  }

  return reply.code(201).send({ id: result.id, deviceId: actor.id, keyId: request.body.keyId });
}

async function publishOneTimePrekeys(
  request: FastifyRequest<{ Body: OneTimePrekeyBody; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }

  const prekeys: { keyId: number; publicKey: Buffer }[] = [];
  for (const prekey of request.body.prekeys) {
    const publicKey = decodeBase64(prekey.publicKey, 32);
    if (!publicKey) {
      return reply.code(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: "A one-time prekey is invalid",
      });
    }
    prekeys.push({ keyId: prekey.keyId, publicKey });
  }

  const now = new Date();
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
    return sendPublicError(reply, 401);
  }

  return reply.code(201).send({ deviceId: actor.id, published: result.length });
}

async function claimOneTimePrekey(
  request: FastifyRequest<{ Body: DeviceQuery; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }

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

    /** Canonical ordering avoids deadlocks between crossed claim requests. */
    const lockedDevices = await transaction
      .select({ id: devices.id, revokedAt: devices.revokedAt })
      .from(devices)
      .where(inArray(devices.id, [actor.id, request.body.deviceId]))
      .orderBy(asc(devices.id))
      .for("update");
    const actorDevice = lockedDevices.find((device) => device.id === actor.id);
    if (!actorDevice || actorDevice.revokedAt) {
      return { kind: "unauthorized" } as const;
    }

    const target = lockedDevices.find((device) => device.id === request.body.deviceId);
    if (!target || target.revokedAt) {
      return { kind: "not-found" } as const;
    }

    const claim = await transaction.execute<ClaimedPrekey>(sql`
      UPDATE one_time_prekeys
      SET claimed_at = now(), claim_receipt_id = gen_random_uuid()
      WHERE id = (
        SELECT id
        FROM one_time_prekeys
        WHERE device_id = ${request.body.deviceId} AND claimed_at IS NULL
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
    return sendPublicError(reply, 401);
  }
  if (result.kind === "not-found" || result.kind === "empty") {
    return sendPublicError(reply, 404);
  }

  const prekey = result.prekey;
  return {
    id: prekey.id,
    deviceId: prekey.device_id,
    keyId: prekey.key_id,
    publicKey: prekey.public_key.toString("base64"),
    createdAt: prekey.created_at,
    claimedAt: prekey.claimed_at,
    claimReceiptId: prekey.claim_receipt_id,
  };
}

async function getSignedPrekey(
  request: FastifyRequest<{ Querystring: DeviceQuery; Headers: SessionHeaders }>,
  reply: FastifyReply,
) {
  const actor = await getAuthenticatedActor(request.headers);
  if (!actor) {
    return sendPublicError(reply, 401);
  }
  if (!(await getActiveDevice(request.query.deviceId))) {
    return sendPublicError(reply, 404);
  }

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
    .where(and(eq(signedPrekeys.deviceId, request.query.deviceId), sql`${signedPrekeys.expiresAt} > now()`))
    .orderBy(desc(signedPrekeys.createdAt))
    .limit(1);
  if (!prekey) {
    return sendPublicError(reply, 404);
  }

  return {
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
  };
}

async function getAuthenticatedActor(headers: SessionHeaders): Promise<Actor | undefined> {
  const token = getSessionToken(headers);
  if (!token) {
    return undefined;
  }

  const tokenHash = hashToken(token);
  const [session] = await db
    .select({
      sessionId: sessions.id,
      tokenHash: sessions.tokenHash,
      id: devices.id,
      userId: devices.userId,
    })
    .from(sessions)
    .innerJoin(devices, eq(sessions.deviceId, devices.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        isNull(devices.revokedAt),
      ),
    )
    .limit(1);
  if (!session) {
    return undefined;
  }

  const storedHash = Buffer.from(session.tokenHash);
  if (storedHash.length !== tokenHash.length || !timingSafeEqual(storedHash, tokenHash)) {
    return undefined;
  }

  return { id: session.id, userId: session.userId, sessionId: session.sessionId, tokenHash };
}

function getSessionToken(headers: SessionHeaders): string | undefined {
  const sessionHeader = headers["x-session-token"];
  const authorization = headers.authorization;
  if (sessionHeader !== undefined && authorization !== undefined) {
    return undefined;
  }
  if (sessionHeader !== undefined) {
    return sessionHeader.length > 0 && sessionHeader.length <= 1024 ? sessionHeader : undefined;
  }
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer ([^\s]{1,1024})$/i.exec(authorization);
  return match?.[1];
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function matchesSecret(candidate: string, expected: string): boolean {
  const candidateHash = hashToken(candidate);
  const expectedHash = hashToken(expected);
  return timingSafeEqual(candidateHash, expectedHash);
}

function matchesUtf8(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

async function getActiveDevice(deviceId: string) {
  const [device] = await db
    .select({ id: devices.id, userId: devices.userId })
    .from(devices)
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
    .limit(1);
  return device;
}

function decodeBase64(value: string, expectedByteLength: number): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length !== expectedByteLength ||
    decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    return undefined;
  }
  return decoded;
}

function sendPublicError(reply: FastifyReply, statusCode: keyof typeof publicError) {
  return reply.code(statusCode).send({
    statusCode,
    ...publicError[statusCode],
  });
}
