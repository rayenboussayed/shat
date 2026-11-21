import { Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";
import { closeIdentityDatabase } from "./db/db.ts";

/** Closes the shared database pool once when Nest shuts the application down. */
@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  private closed = false;

  /** Ends the shared connection pool, ignoring repeated shutdown signals. */
  async onApplicationShutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await closeIdentityDatabase();
  }
}
