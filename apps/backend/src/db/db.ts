import { Injectable, Module } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../../packages/database/src/schema.ts";

export * from "../../../../packages/database/src/schema.ts";

/** Shared PostgreSQL connection pool for backend routes. */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Drizzle database handle with the shared database schema attached. */
const db = drizzle(pool, { schema });

let poolClosed = false;
let closePromise: Promise<void> | undefined;

/** Closes the shared PostgreSQL connection pool during process shutdown. */
export async function closeIdentityDatabase(): Promise<void> {
  if (poolClosed && closePromise) {
    await closePromise;
    return;
  }
  if (!closePromise) {
    poolClosed = true;
    closePromise = pool.end();
  }
  await closePromise;
}

/** Injectable handle exposing the shared Drizzle database and shutdown lifecycle. */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  /** The shared Drizzle database handle. */
  readonly db = db;

  /** Ends the shared connection pool once when Nest shuts down. */
  async onApplicationShutdown(): Promise<void> {
    await closeIdentityDatabase();
  }
}

/** Nest module providing the injectable database handle. */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
