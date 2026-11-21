import { Injectable } from "@nestjs/common";
import {
  desc,
  eq,
} from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import { deliveryReceipts } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import type { IdentityResult } from "../identity/schemas.ts";
import type { DeliveryReceiptsQuery, SessionHeaders } from "../mailbox/schemas.ts";

const publicError = (statusCode: number) => {
  const map: Record<number, { error: string; message: string }> = {
    400: { error: "Bad Request", message: "The request is invalid" },
    401: { error: "Unauthorized", message: "Authentication is required" },
    403: { error: "Forbidden", message: "The request is not permitted" },
    404: { error: "Not Found", message: "The requested resource was not found" },
  };
  return { statusCode, ...map[statusCode] };
};

/** Delivery receipt listing for envelopes the actor sent. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  /** Lists delivery receipts for envelopes the actor sent. */
  async listReceipts(
    headers: SessionHeaders,
    query: DeliveryReceiptsQuery,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const offset = Math.max(query.offset ?? 0, 0);

    const db = this.database.db;
    const rows = await db
      .select()
      .from(deliveryReceipts)
      .where(eq(deliveryReceipts.senderDeviceId, actor.id))
      .orderBy(desc(deliveryReceipts.receiptAt))
      .limit(limit)
      .offset(offset);

    return {
      status: 200,
      body: {
        receipts: rows.map((row) => ({
          id: row.id,
          messageId: row.messageId,
          recipientDeviceId: row.recipientDeviceId,
          senderDeviceId: row.senderDeviceId,
          state: row.state,
          receiptAt: row.receiptAt,
          metadata: row.metadata,
        })),
      },
    };
  }
}