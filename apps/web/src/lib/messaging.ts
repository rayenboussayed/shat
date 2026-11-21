/**
 * Client-side shapes for mailbox and conversation responses.
 *
 * The generated OpenAPI types do not declare response bodies for these routes
 * (the backend replies through Fastify's reply object), so these interfaces
 * mirror the backend service output and are used to narrow the typed client's
 * `data` value with a documented runtime guard.
 */

/** Shared loading state for mailbox and conversation views. */
export type LoadState = "loading" | "ready" | "error";

/** A conversation as returned by GET /conversations. */
interface ConversationSummary {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string | Date;
  readonly members: readonly string[];
}

/** Response body for GET /conversations. */
export interface ConversationListResponse {
  readonly conversations: readonly ConversationSummary[];
}

/** A mailbox message as returned by GET /mailbox. */
export interface MailboxMessage {
  readonly id: string;
  readonly recipientDeviceId: string;
  readonly conversationId: string | null;
  readonly senderDeviceId: string;
  readonly envelope: string;
  readonly enqueuedAt: string;
  readonly expiresAt: string;
  readonly status: string;
}

/** Response body for GET /mailbox. */
export interface MailboxPollResponse {
  readonly messages: readonly MailboxMessage[];
}

/**
 * Narrows an unknown value to a plain record so property access is safe.
 *
 * @param value - The value to inspect.
 * @returns `true` when `value` is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows an unknown value to a {@link ConversationSummary}.
 *
 * @param value - The value to inspect.
 * @returns `true` when `value` matches the conversation summary shape.
 */
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
 * Narrows an unknown value to a {@link ConversationListResponse}.
 *
 * @param value - The value to inspect.
 * @returns `true` when `value` carries a `conversations` array of summaries.
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

/**
 * Narrows an unknown value to a {@link MailboxMessage}.
 *
 * @param value - The value to inspect.
 * @returns `true` when `value` matches the mailbox message shape.
 */
function isMailboxMessage(value: unknown): value is MailboxMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value["id"] !== "string") {
    return false;
  }
  if (typeof value["recipientDeviceId"] !== "string") {
    return false;
  }
  const conversationId = value["conversationId"];
  if (conversationId !== null && typeof conversationId !== "string") {
    return false;
  }
  if (typeof value["senderDeviceId"] !== "string") {
    return false;
  }
  if (typeof value["envelope"] !== "string") {
    return false;
  }
  if (typeof value["enqueuedAt"] !== "string") {
    return false;
  }
  if (typeof value["expiresAt"] !== "string") {
    return false;
  }
  if (typeof value["status"] !== "string") {
    return false;
  }
  return true;
}

/**
 * Narrows an unknown value to a {@link MailboxPollResponse}.
 *
 * @param value - The value to inspect.
 * @returns `true` when `value` carries a `messages` array of mailbox messages.
 */
export function isMailboxPollResponse(value: unknown): value is MailboxPollResponse {
  if (!isRecord(value)) {
    return false;
  }
  const messages = value["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }
  return messages.every(isMailboxMessage);
}
