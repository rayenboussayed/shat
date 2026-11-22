import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";

/** Maximum time the database may take to answer a readiness probe, in milliseconds. */
const DATABASE_PROBE_TIMEOUT_MS = 2000;

/** Readiness indicator that runs a trivial query against PostgreSQL. */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly indicators: HealthIndicatorService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Probes the database with a bounded query. Any rejection is replaced with a generic
   * error before Terminus sees it, so driver errors (hosts, users, connection strings)
   * cannot leak through a timeout race into the response or its failure data.
   */
  check() {
    return this.indicators
      .check("database")
      .attempt(async () => {
        try {
          return await this.database.db.execute(sql`select 1`);
        } catch {
          throw new Error("The database is unreachable");
        }
      })
      .withTimeout(DATABASE_PROBE_TIMEOUT_MS)
      .withFailureData({ message: "The database is unreachable" });
  }
}
