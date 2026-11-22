import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const enrollmentSecret = randomBytes(32).toString("base64url");
const actorToken = randomBytes(32).toString("base64url");
const recipientToken = randomBytes(32).toString("base64url");
const userId = randomUUID();
const actorDeviceId = randomUUID();
const recipientDeviceId = randomUUID();
const revokedDeviceId = randomUUID();

describe("Identity and prekey routes", () => {
  let app: NestFastifyApplication;
  let adminPool: Pool | undefined;
  let client: PoolClient | undefined;
  let schemaName: string | undefined;
  let schemaCreated = false;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalEnrollmentSecret = process.env.SHAT_ENROLLMENT_TOKEN;
  const originalEnrollmentUserId = process.env.SHAT_ENROLLMENT_USER_ID;
  const getDatabaseClient = (): PoolClient => {
    if (!client) {
      throw new Error("A database client is required for this test");
    }
    return client;
  };

  beforeAll(async () => {
    if (databaseUrl) {
      process.env.SHAT_ENROLLMENT_TOKEN = enrollmentSecret;
      process.env.SHAT_ENROLLMENT_USER_ID = userId;
      adminPool = new Pool({ connectionString: databaseUrl });
      client = await adminPool.connect();
      schemaName = `shat_s4_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${schemaName}", public`);
      const migration = await readFile(
        new URL("../../drizzle/0001_initial_shat.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);

      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
      process.env.DATABASE_URL = runtimeUrl.toString();
    } else {
      delete process.env.SHAT_ENROLLMENT_TOKEN;
      delete process.env.SHAT_ENROLLMENT_USER_ID;
    }

    const { buildApp } = await import("../../src/app.js");
    const { AppModule } = await import("../../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();

    if (client) {
      await client.query(
        `INSERT INTO users (id, created_at, status)
         VALUES ($1, now(), 'active')`,
        [userId],
      );
      await client.query(
        `INSERT INTO devices (id, user_id, created_at, last_seen_at, revoked_at)
         VALUES ($1, $4, now(), now(), NULL),
                ($2, $4, now(), now(), NULL),
                ($3, $4, now(), now(), now())`,
        [actorDeviceId, recipientDeviceId, revokedDeviceId, userId],
      );
      await insertSession(client, actorDeviceId, actorToken);
      await insertSession(client, recipientDeviceId, recipientToken);
    }
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    const { closeIdentityDatabase } = await import("../../src/db/db.js");
    await closeIdentityDatabase();
    restoreEnvironmentVariable("DATABASE_URL", originalDatabaseUrl);
    restoreEnvironmentVariable("SHAT_ENROLLMENT_TOKEN", originalEnrollmentSecret);
    restoreEnvironmentVariable("SHAT_ENROLLMENT_USER_ID", originalEnrollmentUserId);
    try {
      if (client && schemaCreated && schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
    } finally {
      client?.release();
      await adminPool?.end();
    }
  }, 30_000);

  it("rejects device registration without a deviceId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/identity/devices",
      payload: { userId },
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not accept a device ID as authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/identity/devices?userId=${userId}`,
      headers: { "x-device-id": actorDeviceId },
    });

    expect(response.statusCode).toBe(401);
  });

  it("fails closed when the enrollment owner is not configured", async () => {
    const originalSecret = process.env.SHAT_ENROLLMENT_TOKEN;
    const originalUserId = process.env.SHAT_ENROLLMENT_USER_ID;
    process.env.SHAT_ENROLLMENT_TOKEN = enrollmentSecret;
    delete process.env.SHAT_ENROLLMENT_USER_ID;
    try {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentSecret },
        payload: { deviceId: randomUUID(), userId },
      });

      expect(response.statusCode).toBe(503);
    } finally {
      restoreEnvironmentVariable("SHAT_ENROLLMENT_TOKEN", originalSecret);
      restoreEnvironmentVariable("SHAT_ENROLLMENT_USER_ID", originalUserId);
    }
  });

  it.each(["secret", "a".repeat(32)])(
    "fails closed when the enrollment token is too weak (%s)",
    async (weakToken) => {
      const originalSecret = process.env.SHAT_ENROLLMENT_TOKEN;
      const originalUserId = process.env.SHAT_ENROLLMENT_USER_ID;
      process.env.SHAT_ENROLLMENT_TOKEN = weakToken;
      process.env.SHAT_ENROLLMENT_USER_ID = userId;
      try {
        const response = await app.inject({
          method: "POST",
          url: "/identity/devices",
          headers: { "x-enrollment-token": weakToken },
          payload: { deviceId: randomUUID(), userId },
        });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ error: "Service Unavailable" });
      } finally {
        restoreEnvironmentVariable("SHAT_ENROLLMENT_TOKEN", originalSecret);
        restoreEnvironmentVariable("SHAT_ENROLLMENT_USER_ID", originalUserId);
      }
    },
  );

  it("preserves the identity error envelope without requestId", async () => {
    const identityResponse = await app.inject({
      method: "POST",
      url: "/identity/devices",
      payload: {},
    });
    const globalResponse = await app.inject({
      method: "GET",
      url: "/missing",
    });

    expect(identityResponse.statusCode).toBe(400);
    expect(identityResponse.json()).not.toHaveProperty("requestId");
    expect(globalResponse.statusCode).toBe(404);
    expect(globalResponse.json()).toHaveProperty("requestId");
  });

  describe.skipIf(!databaseUrl)("database-backed identity and prekey routes", () => {
    it("rejects enrollment for an account other than the configured owner", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentSecret },
        payload: { deviceId: randomUUID(), userId: randomUUID() },
      });

      expect(response.statusCode).toBe(403);
    });

    it("enrolls a device with a secret and returns a session token", async () => {
      const newDeviceId = randomUUID();
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentSecret },
        payload: {
          deviceId: newDeviceId,
          userId,
          identityPublicKey: Buffer.alloc(32, 7).toString("base64"),
          algorithm: "X25519",
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        deviceId: newDeviceId,
        userId,
        identityKey: { algorithm: "X25519" },
      });
      expect(response.json().sessionToken).toEqual(expect.any(String));
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/identity/devices?userId=${userId}`,
            headers: { authorization: `Bearer ${response.json().sessionToken}` },
          })
        ).statusCode,
      ).toBe(200);
    });

    it("returns 409 for a concurrent device ID conflict", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentSecret },
        payload: { deviceId: actorDeviceId, userId },
      });

      expect(response.statusCode).toBe(409);
    });

    it("rejects identity keys with the wrong decoded length", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentSecret },
        payload: {
          deviceId: randomUUID(),
          userId,
          identityPublicKey: Buffer.alloc(31).toString("base64"),
          algorithm: "X25519",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("publishes and replaces one signed prekey per device", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/prekeys/publish",
        headers: { "x-session-token": actorToken },
        payload: {
          keyId: 1,
          publicKey: Buffer.alloc(32, 1).toString("base64"),
          signature: Buffer.alloc(64, 2).toString("base64"),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      const second = await app.inject({
        method: "POST",
        url: "/prekeys/publish",
        headers: { "x-session-token": actorToken },
        payload: {
          keyId: 2,
          publicKey: Buffer.alloc(32, 3).toString("base64"),
          signature: Buffer.alloc(64, 4).toString("base64"),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().id).toBe(first.json().id);
      const { rows } = await getDatabaseClient().query(
        "SELECT count(*)::integer AS count FROM signed_prekeys WHERE device_id = $1",
        [actorDeviceId],
      );
      expect(rows[0].count).toBe(1);
    });

    it("rejects prekeys with invalid decoded key or signature lengths", async () => {
      const signedPrekey = await app.inject({
        method: "POST",
        url: "/prekeys/publish",
        headers: { "x-session-token": actorToken },
        payload: {
          keyId: 3,
          publicKey: Buffer.alloc(31).toString("base64"),
          signature: Buffer.alloc(64).toString("base64"),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      const oneTimePrekey = await app.inject({
        method: "POST",
        url: "/prekeys/one-time",
        headers: { "x-session-token": actorToken },
        payload: {
          prekeys: [{ keyId: 103, publicKey: Buffer.alloc(31).toString("base64") }],
        },
      });

      expect(signedPrekey.statusCode).toBe(400);
      expect(oneTimePrekey.statusCode).toBe(400);
    });

    it("publishes, claims, and cannot claim the same one-time prekey twice", async () => {
      const key = Buffer.alloc(32, 11);
      const publish = await app.inject({
        method: "POST",
        url: "/prekeys/one-time",
        headers: {
          "x-session-token": recipientToken,
          "x-device-id": actorDeviceId,
        },
        payload: { prekeys: [{ keyId: 101, publicKey: key.toString("base64") }] },
      });
      const firstClaim = await app.inject({
        method: "POST",
        url: "/prekeys/claim",
        headers: { "x-session-token": actorToken },
        payload: { deviceId: recipientDeviceId },
      });
      const secondClaim = await app.inject({
        method: "POST",
        url: "/prekeys/claim",
        headers: { "x-session-token": actorToken },
        payload: { deviceId: recipientDeviceId },
      });

      expect(publish.statusCode).toBe(201);
      expect(publish.json()).toMatchObject({ deviceId: recipientDeviceId, published: 1 });
      expect(firstClaim.statusCode).toBe(200);
      expect(firstClaim.json()).toMatchObject({
        deviceId: recipientDeviceId,
        keyId: 101,
        publicKey: key.toString("base64"),
      });
      expect(firstClaim.json().claimReceiptId).toEqual(expect.any(String));
      expect(secondClaim.statusCode).toBe(404);
    });

    it("allows exactly one concurrent claim for a single prekey", async () => {
      await app.inject({
        method: "POST",
        url: "/prekeys/one-time",
        headers: { "x-session-token": recipientToken },
        payload: {
          prekeys: [{ keyId: 102, publicKey: Buffer.alloc(32, 12).toString("base64") }],
        },
      });

      const claims = await Promise.all([
        app.inject({
          method: "POST",
          url: "/prekeys/claim",
          headers: { "x-session-token": actorToken },
          payload: { deviceId: recipientDeviceId },
        }),
        app.inject({
          method: "POST",
          url: "/prekeys/claim",
          headers: { "x-session-token": actorToken },
          payload: { deviceId: recipientDeviceId },
        }),
      ]);

      expect(claims.filter((claim) => claim.statusCode === 200)).toHaveLength(1);
      expect(claims.filter((claim) => claim.statusCode === 404)).toHaveLength(1);
    });

    it("rejects claims for a revoked device", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/prekeys/claim",
        headers: { "x-session-token": actorToken },
        payload: { deviceId: revokedDeviceId },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

async function insertSession(client: PoolClient, deviceId: string, token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest();
  await client.query(
    `INSERT INTO sessions
       (id, device_id, token_hash, created_at, expires_at, last_used_at, client_info)
     VALUES ($1, $2, $3, now(), now() + interval '1 day', now(), '{}'::jsonb)`,
    [randomUUID(), deviceId, tokenHash],
  );
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
