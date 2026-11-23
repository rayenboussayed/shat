import { base64Schema } from "../encoding.ts";
import { UUID_PATTERN_STRING } from "../uuid.ts";

/** UUID pattern shared by mailbox payloads. */
const uuidSchema = {
  type: "string",
  pattern: UUID_PATTERN_STRING,
} as const;

/** Loose base64 string bounds; exact byte lengths are checked in services. */
/** JSON Schema for submitting a ciphertext envelope. */
export const mailboxCreateBodySchema = {
  type: "object",
  properties: {
    recipientDeviceId: uuidSchema,
    conversationId: uuidSchema,
    envelope: base64Schema,
    expiry: { type: "string", format: "date-time" },
  },
  required: ["recipientDeviceId", "envelope", "expiry"],
  additionalProperties: false,
} as const;

/** JSON Schema for polling the mailbox. */
export const mailboxQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  additionalProperties: false,
} as const;

/** JSON Schema for acknowledging a mailbox message. */
export const mailboxAckParamsSchema = {
  type: "object",
  properties: { id: uuidSchema },
  required: ["id"],
  additionalProperties: false,
} as const;

/** JSON Schema for the acknowledgement body. */
export const mailboxAckBodySchema = {
  type: "object",
  properties: {
    state: { type: "string", enum: ["delivered", "read"] },
  },
  additionalProperties: false,
} as const;

/** JSON Schema for listing delivery receipts. */
export const deliveryReceiptsQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    offset: { type: "integer", minimum: 0, default: 0 },
  },
  additionalProperties: false,
} as const;

/** Validated body for submitting a ciphertext envelope. */
export interface MailboxCreateBody {
  recipientDeviceId: string;
  conversationId?: string;
  envelope: string;
  expiry: string;
}

/** Validated query for polling the mailbox. */
export interface MailboxQuery {
  limit?: number;
}

/** Validated path parameters for acknowledging a message. */
export interface MailboxAckParams {
  id: string;
}

/** Validated body for acknowledging a message. */
export interface MailboxAckBody {
  state?: "delivered" | "read";
}

/** Validated query for listing delivery receipts. */
export interface DeliveryReceiptsQuery {
  limit?: number;
  offset?: number;
}

/** Authentication headers accepted by mailbox routes. */
export type SessionHeaders = import("../identity/schemas.ts").SessionHeaders;
