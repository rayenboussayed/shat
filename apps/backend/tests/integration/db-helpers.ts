import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

/** Inserts a session whose token hash matches AuthService.hashToken for the supplied token. */
export async function insertSession(client: PoolClient, deviceId: string, token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest();
  await client.query(
    `INSERT INTO sessions
       (id, device_id, token_hash, created_at, expires_at, last_used_at, client_info)
     VALUES ($1, $2, $3, now(), now() + interval '1 day', now(), '{}'::jsonb)`,
    [randomUUID(), deviceId, tokenHash],
  );
}
