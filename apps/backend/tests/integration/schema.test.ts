import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const expectedTables = [
  "users",
  "devices",
  "device_identity_keys",
  "signed_prekeys",
  "one_time_prekeys",
  "conversations",
  "conversation_members",
  "mailbox_messages",
  "delivery_receipts",
  "attachments",
  "sessions",
  "push_endpoints",
  "audit_events",
  "service_metrics",
];
const requiredIndexes = [
  "devices_user_revoked_idx",
  "one_time_prekeys_device_key_unique",
  "one_time_prekeys_unclaimed_device_created_idx",
  "signed_prekeys_device_expiry_created_idx",
  "mailbox_messages_queued_recipient_enqueued_idx",
  "mailbox_messages_expiry_nonterminal_idx",
  "delivery_receipts_message_idx",
  "delivery_receipts_sender_time_idx",
  "sessions_token_hash_unique",
  "audit_events_time_idx",
  "audit_events_type_time_idx",
  "audit_events_actor_time_idx",
  "service_metrics_name_bucket_idx",
];

describe.skipIf(!databaseUrl)("PostgreSQL schema compliance and query plans", () => {
  it("applies the baseline, classifies stored fields, and uses hot-path indexes", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const schemaName = `shat_s2_${Date.now()}_${process.pid}`;
    let client: PoolClient | undefined;
    let schemaCreated = false;

    try {
      client = await pool.connect();
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      schemaCreated = true;
      await client.query(`SET search_path TO "${schemaName}", public`);

      const migration = await readFile(
        new URL("../../drizzle/0001_initial_shat.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);

      const tableResult = await client.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [schemaName],
      );
      expect(tableResult.rows.map((row) => row.table_name).sort()).toEqual([...expectedTables].sort());

      const indexResult = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1`,
        [schemaName],
      );
      const indexNames = new Set(indexResult.rows.map((row) => row.indexname));
      for (const indexName of requiredIndexes) {
        expect(indexNames.has(indexName), `missing required index ${indexName}`).toBe(true);
      }

      const tableComments = await client.query<{ table_name: string; comment: string | null }>(
        `SELECT c.relname AS table_name, obj_description(c.oid) AS comment
         FROM pg_class AS c
         JOIN pg_namespace AS n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [schemaName],
      );
      expect(tableComments.rows).toHaveLength(expectedTables.length);
      for (const table of tableComments.rows) {
        expect(
          table.comment,
          `${table.table_name} must document purpose, retention, access, and identifiability`,
        ).toMatch(/^Purpose=.+; retention=.+; access=.+; identifies_person=(yes|no|indirect)$/);
      }

      const classifications = await client.query<{
        table_name: string;
        column_name: string;
        comment: string | null;
      }>(
        `SELECT c.relname AS table_name,
                a.attname AS column_name,
                col_description(c.oid, a.attnum) AS comment
         FROM pg_class AS c
         JOIN pg_namespace AS n ON n.oid = c.relnamespace
         JOIN pg_attribute AS a ON a.attrelid = c.oid
         WHERE n.nspname = $1
           AND c.relkind = 'r'
           AND a.attnum > 0
           AND NOT a.attisdropped`,
        [schemaName],
      );
      expect(classifications.rows).toHaveLength(97);
      for (const field of classifications.rows) {
        expect(
          field.comment,
          `${field.table_name}.${field.column_name} must document purpose, retention, access, and identifiability`,
        ).toMatch(/^Purpose=.+; retention=.+; access=.+; identifies_person=(yes|no|indirect)$/);
      }

      const userId = randomUUID();
      const senderDeviceId = randomUUID();
      const recipientDeviceId = randomUUID();
      const conversationId = randomUUID();
      await client.query(
        `INSERT INTO users (id, created_at, status)
         VALUES ($1, now(), 'active')`,
        [userId],
      );
      await client.query(
        `INSERT INTO devices (id, user_id, created_at, last_seen_at)
         VALUES ($1, $3, now(), now()), ($2, $3, now(), now())`,
        [senderDeviceId, recipientDeviceId, userId],
      );
      await client.query(
        `INSERT INTO conversations (id, kind, created_at)
         VALUES ($1, 'direct', now())`,
        [conversationId],
      );
      await client.query(
        `INSERT INTO mailbox_messages
           (id, recipient_device_id, conversation_id, sender_device_id, envelope,
            enqueued_at, expires_at, status)
         SELECT gen_random_uuid(), $1, $2, $3, decode('01', 'hex'),
                now() + (n * interval '1 millisecond'), now() + interval '1 hour', 'queued'
         FROM generate_series(1, 20) AS n`,
        [recipientDeviceId, conversationId, senderDeviceId],
      );
      await client.query(
        `INSERT INTO one_time_prekeys (id, device_id, key_id, public_key, created_at)
         SELECT gen_random_uuid(), $1, n, decode('01', 'hex'),
                now() + (n * interval '1 millisecond')
         FROM generate_series(1, 20) AS n`,
        [recipientDeviceId],
      );
      await client.query("SET enable_seqscan = off");

      const mailboxPlan = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT id
         FROM mailbox_messages
         WHERE recipient_device_id = $1 AND status = 'queued'
         ORDER BY enqueued_at
         LIMIT 10`,
        [recipientDeviceId],
      );
      const mailboxPlanText = JSON.stringify(mailboxPlan.rows[0]?.["QUERY PLAN"] ?? null);
      expect(mailboxPlanText).toContain("Index Scan");
      expect(mailboxPlanText).toContain("mailbox_messages_queued_recipient_enqueued_idx");

      const prekeyClaimPlan = await client.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         WITH candidate AS (
           SELECT id
           FROM one_time_prekeys
           WHERE device_id = $1 AND claimed_at IS NULL
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE one_time_prekeys
         SET claimed_at = now()
         WHERE id = (SELECT id FROM candidate)`,
        [recipientDeviceId],
      );
      const prekeyPlanText = JSON.stringify(prekeyClaimPlan.rows[0]?.["QUERY PLAN"] ?? null);
      expect(prekeyPlanText).toContain("Index Scan");
      expect(prekeyPlanText).toContain("one_time_prekeys_unclaimed_device_created_idx");
    } finally {
      try {
        if (client && schemaCreated) {
          await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        }
      } finally {
        client?.release();
        await pool.end();
      }
    }
  });
});
