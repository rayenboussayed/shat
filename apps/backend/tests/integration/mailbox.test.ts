import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// buildApp and AppModule are imported dynamically in beforeAll.

const databaseUrl = process.env.DATABASE_URL;
const actorToken = randomBytes(32).toString("base64url");
const recipientToken = randomBytes(32).toString("base64url");
const userId = randomUUID();
const actorDeviceId = randomUUID();
const recipientDeviceId = randomUUID();

describe("Mailbox routes", () => {
  let app: NestFastifyApplication;
  let adminPool: Pool | undefined;
  let client: PoolClient | undefined;
  let schemaName: string | undefined;
  let schemaCreated = false;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (databaseUrl) {
      adminPool = new Pool({ connectionString: databaseUrl });
      client = await adminPool.connect();
      schemaName = `shat_p5_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${schemaName}", public`);
      const migration = await readFile(
        new URL("../../drizzle/0001_initial_shat.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);

      await client.query(
        `INSERT INTO users (id, created_at, status) VALUES ($1, now(), 'active')`,
        [userId],
      );
      await client.query(
        `INSERT INTO devices (id, user_id, created_at, last_seen_at, revoked_at)
         VALUES ($1, $3, now(), now(), NULL), ($2, $3, now(), now(), NULL)`,
        [actorDeviceId, recipientDeviceId, userId],
      );
      await insertSession(client, actorDeviceId, actorToken);
      await insertSession(client, recipientDeviceId, recipientToken);

      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
      process.env.DATABASE_URL = runtimeUrl.toString();
    }

    const { buildApp } = await import("../../src/app.js");
    const { AppModule } = await import("../../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    const { closeIdentityDatabase } = await import("../../src/db/db.js");
    await closeIdentityDatabase();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    try {
      if (client && schemaCreated && schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
    } finally {
      client?.release();
      await adminPool?.end();
    }
  });

  it.skipIf(!databaseUrl)("creates a direct conversation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${actorToken}` },
      payload: { recipientDeviceId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().conversationId).toEqual(expect.any(String));
  });

  it.skipIf(!databaseUrl)("lists conversations for the actor", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/conversations",
      headers: { authorization: `Bearer ${actorToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().conversations)).toBe(true);
  });

  it.skipIf(!databaseUrl)("submits a mailbox envelope", async () => {
    const conversation = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${actorToken}` },
      payload: { recipientDeviceId },
    });
    const conversationId = conversation.json().conversationId;
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${actorToken}` },
      payload: {
        recipientDeviceId,
        conversationId,
        envelope: Buffer.alloc(8).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("queued");
  });

  it.skipIf(!databaseUrl)("polls queued envelopes for the recipient", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/mailbox?limit=10",
      headers: { authorization: `Bearer ${recipientToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().messages)).toBe(true);
  });

  it.skipIf(!databaseUrl)("acknowledges a mailbox message idempotently", async () => {
    const submitted = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${actorToken}` },
      payload: {
        recipientDeviceId,
        envelope: Buffer.alloc(8, 2).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const messageId = submitted.json().messageId;
    const first = await app.inject({
      method: "POST",
      url: `/mailbox/${messageId}/ack`,
      headers: { authorization: `Bearer ${recipientToken}` },
      payload: { state: "read" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/mailbox/${messageId}/ack`,
      headers: { authorization: `Bearer ${recipientToken}` },
      payload: { state: "read" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it.skipIf(!databaseUrl)("upgrades a delivered receipt to read without downgrading", async () => {
    const submitted = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${actorToken}` },
      payload: {
        recipientDeviceId,
        envelope: Buffer.alloc(8, 3).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(submitted.statusCode).toBe(201);
    const messageId = submitted.json<{ messageId: string }>().messageId;
    const ack = (state: string) =>
      app.inject({
        method: "POST",
        url: `/mailbox/${messageId}/ack`,
        headers: { authorization: `Bearer ${recipientToken}` },
        payload: { state },
      });

    const delivered = await ack("delivered");
    const read = await ack("read");
    const noDowngrade = await ack("delivered");

    expect(delivered.statusCode).toBe(200);
    expect(read.statusCode).toBe(200);
    expect(noDowngrade.statusCode).toBe(200);
    const deliveredReceipt = delivered.json<{ receipt: { id: string; state: string; receiptAt: string } }>().receipt;
    const readReceipt = read.json<{ receipt: { id: string; state: string; receiptAt: string } }>().receipt;
    expect(deliveredReceipt.state).toBe("delivered");
    expect(readReceipt).toMatchObject({ id: deliveredReceipt.id, state: "read" });
    expect(Date.parse(readReceipt.receiptAt)).toBeGreaterThanOrEqual(Date.parse(deliveredReceipt.receiptAt));
    expect(noDowngrade.json<{ receipt: { state: string } }>().receipt.state).toBe("read");

    if (client) {
      const { rows } = await client.query(`SELECT state FROM delivery_receipts WHERE message_id = $1`, [messageId]);
      expect(rows[0]?.state).toBe("read");
    }
  });

  it.skipIf(!databaseUrl)("lists delivery receipts for the sender", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/delivery/receipts",
      headers: { authorization: `Bearer ${actorToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().receipts)).toBe(true);
  });

  it.skipIf(!databaseUrl)("uses the queued recipient index for mailbox poll", async () => {
    if (!client) return;
    const senderDeviceId = actorDeviceId;
    const rid = recipientDeviceId;
    await client.query(
      `INSERT INTO mailbox_messages
         (id, recipient_device_id, sender_device_id, envelope, enqueued_at, expires_at, status)
       SELECT gen_random_uuid(), $1, $2, decode('01','hex'),
              now() + (n * interval '1 millisecond'), now() + interval '1 hour', 'queued'
       FROM generate_series(1, 20) AS n`,
      [rid, senderDeviceId],
    );
    await client.query("SET enable_seqscan = off");
    const plan = await client.query<{ "QUERY PLAN": unknown }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id FROM mailbox_messages
       WHERE recipient_device_id = $1 AND status = 'queued'
       ORDER BY enqueued_at
       LIMIT 10`,
      [rid],
    );
    const text = JSON.stringify(plan.rows[0]?.["QUERY PLAN"] ?? null);
    expect(text).toContain("Index Scan");
    expect(text).toContain("mailbox_messages_queued_recipient_enqueued_idx");
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