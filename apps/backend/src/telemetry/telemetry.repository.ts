import { Injectable } from "@nestjs/common";
import { and, count, gt, isNull, sql } from "drizzle-orm";
import { DatabaseService, attachments, devices } from "../db/db.ts";

/** Database-wide totals that carry no identifiers: counts and byte sums only. */
export interface StorageTotals {
  readonly enrolledDevices: number;
  readonly files: number;
  readonly fileBytes: number;
}

/** Reads aggregate totals for the telemetry summary. Never selects identifiers or content. */
@Injectable()
export class TelemetryRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Counts non-revoked devices and live (undeleted, unexpired) attachments with their bytes. */
  async totals(now: Date): Promise<StorageTotals> {
    const db = this.database.db;
    const [deviceRow, fileRow] = await Promise.all([
      db.select({ value: count() }).from(devices).where(isNull(devices.revokedAt)),
      db
        .select({
          files: count(),
          fileBytes: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)`.mapWith(Number),
        })
        .from(attachments)
        .where(and(isNull(attachments.deletedAt), gt(attachments.expiresAt, now))),
    ]);
    return {
      enrolledDevices: deviceRow[0]?.value ?? 0,
      files: fileRow[0]?.files ?? 0,
      fileBytes: fileRow[0]?.fileBytes ?? 0,
    };
  }
}
