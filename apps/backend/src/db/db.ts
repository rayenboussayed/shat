import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../../packages/database/src/schema.ts";

export * from "../../../../packages/database/src/schema.ts";

/** Shared PostgreSQL connection pool for backend routes. */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Drizzle database handle with the shared database schema attached. */
export const db = drizzle(pool, { schema });

/** Closes the shared PostgreSQL connection pool during process shutdown. */
export async function closeIdentityDatabase(): Promise<void> {
  await pool.end();
}
