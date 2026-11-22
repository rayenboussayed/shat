import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertSession } from "./db-helpers.ts";

const databaseUrl = process.env.DATABASE_URL;
const ownerToken = randomBytes(32).toString("base64url");
const recipientToken = randomBytes(32).toString("base64url");
const userId = randomUUID();
const ownerDeviceId = randomUUID();
const recipientDeviceId = randomUUID();
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Attachment routes", () => {
  let app: NestFastifyApplication;
  let adminPool: Pool | undefined;
  let client: PoolClient | undefined;
  const db = (): PoolClient => {
    if (!client) throw new Error("DATABASE_URL is not set for the attachment integration test");
    return client;
  };
  let schemaName: string | undefined;
  let schemaCreated = false;
  let blobDirectory: string | undefined;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalStorageDir = process.env.ATTACHMENT_STORAGE_DIR;

  beforeAll(async () => {
    if (databaseUrl) {
      adminPool = new Pool({ connectionString: databaseUrl });
      client = await adminPool.connect();
      schemaName = `shat_p6_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${schemaName}", public`);
      const migration = await readFile(new URL("../../drizzle/0001_initial_shat.sql", import.meta.url), "utf8");
      await client.query(migration);
      await client.query(`INSERT INTO users (id, created_at, status) VALUES ($1, now(), 'active')`, [userId]);
      await client.query(
        `INSERT INTO devices (id, user_id, created_at, last_seen_at, revoked_at)
         VALUES ($1, $3, now(), now(), NULL), ($2, $3, now(), now(), NULL)`,
        [ownerDeviceId, recipientDeviceId, userId],
      );
      await insertSession(client, ownerDeviceId, ownerToken);
      await insertSession(client, recipientDeviceId, recipientToken);

      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.searchParams.set("options", `-c search_path=${schemaName},public`);
      process.env.DATABASE_URL = runtimeUrl.toString();
      blobDirectory = await mkdtemp(join(tmpdir(), "shat-attachments-"));
      process.env.ATTACHMENT_STORAGE_DIR = blobDirectory;
    }

    const { buildApp } = await import("../../src/app.js");
    const { AppModule } = await import("../../src/app.module.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    const { closeIdentityDatabase } = await import("../../src/db/db.js");
    await closeIdentityDatabase();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalStorageDir === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
    else process.env.ATTACHMENT_STORAGE_DIR = originalStorageDir;
    if (blobDirectory) await rm(blobDirectory, { recursive: true, force: true });
    try {
      if (client && schemaCreated && schemaName) {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      }
    } finally {
      client?.release();
      await adminPool?.end();
    }
  });

  it.skipIf(!databaseUrl)("stores ciphertext and returns an opaque id", async () => {
    const plaintext = randomBytes(256);
    const response = await upload(app, ownerToken, plaintext);

    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();
    const [row] = (
      await db().query(
        `SELECT owner_device_id, size_bytes, digest_sha256 FROM attachments WHERE id = $1`,
        [id],
      )
    ).rows;
    expect(row.owner_device_id).toBe(ownerDeviceId);
    expect(Number(row.size_bytes)).toBe(plaintext.length);
    expect(Buffer.from(row.digest_sha256).equals(createHash("sha256").update(plaintext).digest())).toBe(true);
    expect(response.body).not.toContain(plaintext.toString("base64"));
  });

  it.skipIf(!databaseUrl)("downloads ciphertext through an owner capability", async () => {
    const plaintext = randomBytes(128);
    const { id } = (await upload(app, ownerToken, plaintext)).json<{ id: string }>();
    const { downloadToken } = (
      await app.inject({ method: "GET", url: `/attachments/${id}`, headers: bearer(ownerToken) })
    ).json<{ downloadToken: string }>();

    const download = await app.inject({ method: "GET", url: `/attachments/download?token=${downloadToken}` });

    expect(download.statusCode).toBe(200);
    expect(Buffer.compare(download.rawPayload, plaintext)).toBe(0);
  });

  it.skipIf(!databaseUrl)("hides attachments from non-owners", async () => {
    const { id } = (await upload(app, ownerToken, randomBytes(32))).json<{ id: string }>();

    const response = await app.inject({
      method: "GET",
      url: `/attachments/${id}`,
      headers: bearer(recipientToken),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toHaveProperty("requestId");
  });

  it.skipIf(!databaseUrl)("makes a deleted attachment undownloadable", async () => {
    const plaintext = randomBytes(64);
    const { id } = (await upload(app, ownerToken, plaintext)).json<{ id: string }>();
    const { downloadToken } = (
      await app.inject({ method: "GET", url: `/attachments/${id}`, headers: bearer(ownerToken) })
    ).json<{ downloadToken: string }>();

    const deletion = await app.inject({ method: "DELETE", url: `/attachments/${id}`, headers: bearer(ownerToken) });
    const download = await app.inject({ method: "GET", url: `/attachments/download?token=${downloadToken}` });
    const [remaining] = (await db().query(`SELECT id FROM attachments WHERE id = $1`, [id])).rows;

    expect(deletion.statusCode).toBe(204);
    expect(download.statusCode).toBe(404);
    expect(remaining).toBeUndefined();
  });

  it.skipIf(!databaseUrl)("rejects uploads that would exceed the owner quota", async () => {
    const holderId = randomUUID();
    await db().query(
      `INSERT INTO attachments (id, owner_device_id, storage_key, size_bytes, content_type, digest_sha256, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'application/octet-stream', $5, now(), now() + interval '1 day')`,
      [holderId, ownerDeviceId, randomUUID(), 64 * 1024 * 1024, Buffer.alloc(32)],
    );

    try {
      const response = await upload(app, ownerToken, randomBytes(16));
      expect(response.statusCode).toBe(413);
    } finally {
      await db().query(`DELETE FROM attachments WHERE id = $1`, [holderId]);
    }
  });

  it.skipIf(!databaseUrl)("does not count expired ciphertext against the owner quota", async () => {
    const holderId = randomUUID();
    await db().query(
      `INSERT INTO attachments (id, owner_device_id, storage_key, size_bytes, content_type, digest_sha256, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'application/octet-stream', $5, now(), now() - interval '1 day')`,
      [holderId, ownerDeviceId, randomUUID(), 64 * 1024 * 1024, Buffer.alloc(32)],
    );

    try {
      const response = await upload(app, ownerToken, randomBytes(16));
      expect(response.statusCode).toBe(201);
    } finally {
      await db().query(`DELETE FROM attachments WHERE id = $1`, [holderId]);
    }
  });

  it.skipIf(!databaseUrl)("purges expired attachments and their blobs", async () => {
    const attachmentId = randomUUID();
    const storageKey = randomUUID();
    const bytes = randomBytes(20);
    await writeFile(join(requireDirectory(blobDirectory), storageKey), bytes);
    await db().query(
      `INSERT INTO attachments (id, owner_device_id, storage_key, size_bytes, content_type, digest_sha256, created_at, expires_at)
       VALUES ($1, $2, $3, $4, 'application/octet-stream', $5, now() - interval '2 days', now() - interval '1 day')`,
      [attachmentId, ownerDeviceId, storageKey, bytes.length, createHash("sha256").update(bytes).digest()],
    );
    const { AttachmentsService } = await import("../../src/attachments/attachments.service.js");

    const purged = await app.get(AttachmentsService).purgeExpired(new Date());

    const [row] = (await db().query(`SELECT id FROM attachments WHERE id = $1`, [attachmentId])).rows;
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(row).toBeUndefined();
    await expect(readFile(join(requireDirectory(blobDirectory), storageKey))).rejects.toThrow();
  });

  it.skipIf(!databaseUrl)("uses the owner and deleted-at index for owner-scoped reads", async () => {
    await db().query("SET enable_seqscan = off");
    try {
      const plan = await db().query(
        `EXPLAIN SELECT id FROM attachments WHERE owner_device_id = $1 AND deleted_at IS NULL`,
        [ownerDeviceId],
      );
      const text = plan.rows.map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"]).join("\n");
      expect(text).toContain("attachments_owner_deleted_idx");
    } finally {
      await db().query("SET enable_seqscan = on");
    }
  });
});

function requireDirectory(directory: string | undefined): string {
  if (!directory) throw new Error("ATTACHMENT_STORAGE_DIR was not created");
  return directory;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function upload(app: NestFastifyApplication, token: string, plaintext: Buffer) {
  return app.inject({
    method: "POST",
    url: "/attachments",
    headers: bearer(token),
    payload: {
      ciphertext: plaintext.toString("base64"),
      contentType: "application/octet-stream",
      digestSha256: createHash("sha256").update(plaintext).digest("base64"),
      expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    },
  });
}
