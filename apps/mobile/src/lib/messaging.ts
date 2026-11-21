/**
 * Client-side shapes for mailbox and conversation responses.
 */

/** Loading state for the chat screen. */
export type LoadState = "loading" | "ready" | "error";

interface ConversationSummary {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string | Date;
  readonly members: readonly string[];
}

/** Response shape for a conversation list. */
export interface ConversationListResponse {
  readonly conversations: readonly ConversationSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConversationSummary(value: unknown): value is ConversationSummary {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value["id"] !== "string") {
    return false;
  }
  if (typeof value["kind"] !== "string") {
    return false;
  }
  const createdAt = value["createdAt"];
  if (typeof createdAt !== "string" && !(createdAt instanceof Date)) {
    return false;
  }
  const members = value["members"];
  if (!Array.isArray(members)) {
    return false;
  }
  return members.every((member) => typeof member === "string");
}

/**
 * Type guard for a conversation list response.
 *
 * @param value - Unknown value to validate.
 * @returns True when the value matches the expected shape.
 */
export function isConversationListResponse(value: unknown): value is ConversationListResponse {
  if (!isRecord(value)) {
    return false;
  }
  const conversations = value["conversations"];
  if (!Array.isArray(conversations)) {
    return false;
  }
  return conversations.every(isConversationSummary);
}
