/** UUID pattern shared by mailbox payloads. */
const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

/** JSON Schema for creating a direct conversation. */
export const conversationCreateBodySchema = {
  type: "object",
  properties: { recipientDeviceId: uuidSchema },
  required: ["recipientDeviceId"],
  additionalProperties: false,
} as const;

/** JSON Schema for listing conversations. */
export const conversationsQuerySchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    offset: { type: "integer", minimum: 0, default: 0 },
  },
  additionalProperties: false,
} as const;

/** Validated body for creating a direct conversation. */
export interface ConversationCreateBody {
  recipientDeviceId: string;
}

/** Validated query for listing conversations. */
export interface ConversationsQuery {
  limit?: number;
  offset?: number;
}

/** Authentication headers accepted by conversation routes. */
export type SessionHeaders = import("../identity/schemas.ts").SessionHeaders;