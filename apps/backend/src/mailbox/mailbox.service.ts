import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  isNull,
} from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import {
  conversationMembers,
  conversations,
  deliveryReceipts,
  mailboxMessages,
} from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import type { IdentityResult } from "../identity/schemas.ts";
import type {
  MailboxAckBody,
  MailboxAckParams,
  MailboxCreateBody,
  MailboxQuery,
  SessionHeaders,
} from "./schemas.ts";

const publicError = (statusCode: number) => {
  const map: Record<number, { error: string; message: string }> = {
    400: { error: "Bad Request", message: "The request is invalid" },
    401: { error: "Unauthorized", message: "Authentication is required" },
    403: { error: "Forbidden", message: "The request is not permitted" },
    404: { error: "Not Found", message: "The requested resource was not found" },
    409: { error: "Conflict", message: "The request conflicts with current state" },
  };
  return { statusCode, ...map[statusCode] };
};

const MAX_ENVELOPE_BYTES = 8192;

function parseExpiry(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

/** Variable-length base64 envelope validator; AuthService.decodeBase64 requires an exact byte length, which does not fit envelopes up to 8192 bytes. */
function validateBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.length > MAX_ENVELOPE_BYTES) return undefined;
  if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return undefined;
  return decoded;
}

/** Mailbox submission, polling and acknowledgement. */
@Injectable()
export class MailboxService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  /** Submits a ciphertext envelope for a recipient device. */
  async createMessage(
    headers: SessionHeaders,
    body: MailboxCreateBody,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const recipient = await this.auth.getActiveDevice(body.recipientDeviceId);
    if (!recipient) {
      return { status: 404, body: publicError(404) };
    }

    const envelopeBuffer = validateBase64(body.envelope);
    if (!envelopeBuffer) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "The envelope is invalid" },
      };
    }

    const expiry = parseExpiry(body.expiry);
    if (!expiry) {
      return {
        status: 400,
        body: { statusCode: 400, error: "Bad Request", message: "The expiry is invalid" },
      };
    }

    const conversationId = body.conversationId;
    if (conversationId) {
      const [conversation] = await this.database.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);
      if (!conversation) {
        return { status: 404, body: publicError(404) };
      }
      const [membership] = await this.database.db
        .select({ id: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.memberDeviceId, actor.id),
            isNull(conversationMembers.leftAt),
          ),
        )
        .limit(1);
      if (!membership) {
        return { status: 403, body: publicError(403) };
      }
      const [recipientMembership] = await this.database.db
        .select({ id: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.memberDeviceId, body.recipientDeviceId),
            isNull(conversationMembers.leftAt),
          ),
        )
        .limit(1);
      if (!recipientMembership) {
        return { status: 403, body: publicError(403) };
      }
    }

    const messageId = randomUUID();
    const db = this.database.db;
    const now = new Date();

    type MailboxRow = typeof mailboxMessages.$inferSelect;
    let resultRow: MailboxRow | undefined;

    await db.transaction(async (transaction) => {
      const [duplicate] = await transaction
        .select()
        .from(mailboxMessages)
        .where(
          and(
            eq(mailboxMessages.senderDeviceId, actor.id),
            eq(mailboxMessages.recipientDeviceId, body.recipientDeviceId),
            eq(mailboxMessages.envelope, envelopeBuffer),
            conversationId
              ? eq(mailboxMessages.conversationId, conversationId)
              : isNull(mailboxMessages.conversationId),
          ),
        )
        .limit(1);
      if (duplicate) {
        resultRow = duplicate;
        return;
      }
      await transaction.insert(mailboxMessages).values({
        id: messageId,
        recipientDeviceId: body.recipientDeviceId,
        conversationId: conversationId ?? null,
        senderDeviceId: actor.id,
        envelope: envelopeBuffer,
        enqueuedAt: now,
        expiresAt: expiry,
        status: "queued",
        attemptCount: 0,
      });
      resultRow = {
        id: messageId,
        recipientDeviceId: body.recipientDeviceId,
        conversationId: conversationId ?? null,
        senderDeviceId: actor.id,
        envelope: envelopeBuffer,
        enqueuedAt: now,
        expiresAt: expiry,
        status: "queued",
        ackedAt: null,
        attemptCount: 0,
      } as MailboxRow;
    });

    if (!resultRow) {
      return { status: 500, body: { statusCode: 500, error: "Internal Server Error", message: "An unexpected error occurred" } };
    }
    const row = resultRow;

    return {
      status: 201,
      body: {
        messageId: row.id,
        recipientDeviceId: row.recipientDeviceId,
        conversationId: row.conversationId,
        senderDeviceId: row.senderDeviceId,
        envelope: Buffer.from(row.envelope).toString("base64"),
        enqueuedAt: row.enqueuedAt instanceof Date ? row.enqueuedAt.toISOString() : String(row.enqueuedAt),
        expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
        status: row.status,
      },
    };
  }

  /** Polls queued envelopes for the recipient device. */
  async pollMessages(
    headers: SessionHeaders,
    query: MailboxQuery,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const db = this.database.db;
    const now = new Date();
    const rows = await db
      .select()
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.recipientDeviceId, actor.id),
          eq(mailboxMessages.status, "queued"),
          gt(mailboxMessages.expiresAt, now),
        ),
      )
      .orderBy(asc(mailboxMessages.enqueuedAt))
      .limit(limit);

    return {
      status: 200,
      body: {
        messages: rows.map((row) => ({
          id: row.id,
          recipientDeviceId: row.recipientDeviceId,
          conversationId: row.conversationId,
          senderDeviceId: row.senderDeviceId,
          envelope: Buffer.from(row.envelope).toString("base64"),
          enqueuedAt: row.enqueuedAt instanceof Date ? row.enqueuedAt.toISOString() : String(row.enqueuedAt),
          expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
          status: row.status,
        })),
      },
    };
  }

  /** Acknowledges a mailbox message by the recipient. */
  async ackMessage(
    headers: SessionHeaders,
    params: MailboxAckParams,
    body: MailboxAckBody,
  ): Promise<IdentityResult> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      return { status: 401, body: publicError(401) };
    }

    const state = body?.state === "read" ? "read" : "delivered";
    const db = this.database.db;
    const now = new Date();

    const [message] = await db
      .select()
      .from(mailboxMessages)
      .where(eq(mailboxMessages.id, params.id))
      .limit(1);
    if (!message) {
      return { status: 404, body: publicError(404) };
    }
    if (message.recipientDeviceId !== actor.id) {
      return { status: 403, body: publicError(403) };
    }

    let receiptId = "";
    let receiptState = state;
    let receiptAt = now;

    await db.transaction(async (transaction) => {
      if (message.status !== "acked") {
        await transaction
          .update(mailboxMessages)
          .set({ status: "acked", ackedAt: now })
          .where(eq(mailboxMessages.id, params.id));
      }
      const [existingReceipt] = await transaction
        .select()
        .from(deliveryReceipts)
        .where(eq(deliveryReceipts.messageId, params.id))
        .limit(1);
      if (existingReceipt) {
        receiptId = existingReceipt.id;
        receiptState = existingReceipt.state;
        receiptAt =
          existingReceipt.receiptAt instanceof Date
            ? existingReceipt.receiptAt
            : new Date(existingReceipt.receiptAt);
      } else {
        receiptId = randomUUID();
        await transaction.insert(deliveryReceipts).values({
          id: receiptId,
          messageId: params.id,
          recipientDeviceId: message.recipientDeviceId,
          senderDeviceId: message.senderDeviceId,
          state,
          receiptAt: now,
          metadata: {},
        });
      }
    });

    if (!receiptId) {
      return { status: 500, body: { statusCode: 500, error: "Internal Server Error", message: "An unexpected error occurred" } };
    }

    return {
      status: 200,
      body: {
        messageId: params.id,
        status: "acked",
        receipt: {
          id: receiptId,
          state: receiptState,
          receiptAt: receiptAt instanceof Date ? receiptAt.toISOString() : String(receiptAt),
        },
      },
    };
  }
}
