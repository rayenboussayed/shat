import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  interval,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/** Accounts, their lifecycle status and soft-delete timestamp. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [check("users_status_check", sql`${table.status} IN ('active', 'disabled', 'deleted')`)],
);

/** Devices enrolled under an account, with last-seen and revocation state. */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("devices_user_revoked_idx").on(table.userId, table.revokedAt)],
);

/** Identity public key published by each device, with algorithm and rotation time. */
export const deviceIdentityKeys = pgTable("device_identity_keys", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => devices.id),
  publicKey: bytea("public_key").notNull(),
  algorithm: text("algorithm").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

/** Signed prekey published by a device for peers starting a session. */
export const signedPrekeys = pgTable(
  "signed_prekeys",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    keyId: integer("key_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    signature: bytea("signature").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("signed_prekeys_device_id_unique").on(table.deviceId),
    index("signed_prekeys_device_expiry_created_idx").on(
      table.deviceId,
      table.expiresAt.desc(),
      table.createdAt.desc(),
    ),
  ],
);

/** Single-use prekeys claimed by peers, tracked by key id and claim receipt. */
export const oneTimePrekeys = pgTable(
  "one_time_prekeys",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    keyId: integer("key_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimReceiptId: uuid("claim_receipt_id"),
  },
  (table) => [
    unique("one_time_prekeys_device_key_unique").on(table.deviceId, table.keyId),
    index("one_time_prekeys_unclaimed_device_created_idx")
      .on(table.deviceId, table.createdAt, table.claimedAt)
      .where(sql`${table.claimedAt} IS NULL`),
  ],
);

/** Conversation threads, either direct or group, with soft-delete support. */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [check("conversations_kind_check", sql`${table.kind} IN ('direct', 'group')`)],
);

/** Device membership and role in each conversation, including leave time. */
export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    memberDeviceId: uuid("member_device_id")
      .notNull()
      .references(() => devices.id),
    role: text("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.memberDeviceId] }),
    index("conversation_members_device_left_idx").on(table.memberDeviceId, table.leftAt),
  ],
);

/** Offline envelopes queued per recipient device until delivery, ack or expiry. */
export const mailboxMessages = pgTable(
  "mailbox_messages",
  {
    id: uuid("id").primaryKey(),
    recipientDeviceId: uuid("recipient_device_id")
      .notNull()
      .references(() => devices.id),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    senderDeviceId: uuid("sender_device_id").references(() => devices.id),
    envelope: bytea("envelope").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
  },
  (table) => [
    check(
      "mailbox_messages_status_check",
      sql`${table.status} IN ('queued', 'delivered', 'acked', 'expired', 'dead')`,
    ),
    index("mailbox_messages_queued_recipient_enqueued_idx")
      .on(table.recipientDeviceId, table.status, table.enqueuedAt)
      .where(sql`${table.status} = 'queued'`),
    index("mailbox_messages_expiry_nonterminal_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} NOT IN ('acked', 'expired', 'dead')`),
  ],
);

/** Delivery, read and failure receipts tied to queued mailbox messages. */
export const deliveryReceipts = pgTable(
  "delivery_receipts",
  {
    id: uuid("id").primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => mailboxMessages.id),
    recipientDeviceId: uuid("recipient_device_id")
      .notNull()
      .references(() => devices.id),
    senderDeviceId: uuid("sender_device_id").references(() => devices.id),
    state: text("state").notNull(),
    receiptAt: timestamp("receipt_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    check("delivery_receipts_state_check", sql`${table.state} IN ('delivered', 'read', 'failed')`),
    index("delivery_receipts_message_idx").on(table.messageId),
    index("delivery_receipts_sender_time_idx").on(table.senderDeviceId, table.receiptAt.desc()),
  ],
);

/** Blob metadata for device-owned uploads, including digest and expiry. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    ownerDeviceId: uuid("owner_device_id")
      .notNull()
      .references(() => devices.id),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    digestSha256: bytea("digest_sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("attachments_owner_deleted_idx").on(table.ownerDeviceId, table.deletedAt)],
);

/** Hashed session tokens with issue, expiry, last-use and revocation state. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    tokenHash: bytea("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    clientInfo: jsonb("client_info").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    unique("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_device_revoked_idx").on(table.deviceId, table.revokedAt),
  ],
);

/** Push endpoints registered per device, with encrypted target and lookup hash. */
export const pushEndpoints = pgTable(
  "push_endpoints",
  {
    id: uuid("id").primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    provider: text("provider").notNull(),
    endpointCiphertext: bytea("endpoint_ciphertext").notNull(),
    endpointHash: bytea("endpoint_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    check("push_endpoints_provider_check", sql`${table.provider} IN ('apns', 'fcm', 'webpush')`),
    index("push_endpoints_device_disabled_idx").on(table.deviceId, table.disabledAt),
  ],
);

/** Pseudonymized audit trail of security-relevant events and their outcomes. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    actorPseudonym: bytea("actor_pseudonym").notNull(),
    deviceId: uuid("device_id").references(() => devices.id),
    eventType: text("event_type").notNull(),
    outcome: text("outcome").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    requestId: uuid("request_id"),
  },
  (table) => [
    index("audit_events_time_idx").on(table.eventTime.desc()),
    index("audit_events_type_time_idx").on(table.eventType, table.eventTime.desc()),
    index("audit_events_actor_time_idx").on(table.actorPseudonym, table.eventTime.desc()),
  ],
);

/** Time-bucketed service metric samples keyed by metric name and dimensions. */
export const serviceMetrics = pgTable(
  "service_metrics",
  {
    id: uuid("id").primaryKey(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    bucketSize: interval("bucket_size").notNull(),
    metricName: text("metric_name").notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, string | number | boolean | null>>().notNull(),
    valueDouble: doublePrecision("value_double"),
    valueBigint: bigint("value_bigint", { mode: "number" }),
    sampleCount: bigint("sample_count", { mode: "number" }).notNull(),
  },
  (table) => [
    unique("service_metrics_name_bucket_dimensions_unique").on(
      table.metricName,
      table.bucketStart,
      table.dimensions,
    ),
    index("service_metrics_name_bucket_idx").on(table.metricName, table.bucketStart.desc()),
  ],
);
