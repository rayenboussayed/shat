CREATE TABLE "users" (
  "id" uuid PRIMARY KEY NOT NULL,
  "created_at" timestamptz NOT NULL,
  "status" text NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled', 'deleted'))
);

CREATE TABLE "devices" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz NOT NULL,
  "revoked_at" timestamptz
);

CREATE TABLE "device_identity_keys" (
  "device_id" uuid PRIMARY KEY NOT NULL REFERENCES "devices"("id"),
  "public_key" bytea NOT NULL,
  "algorithm" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "rotated_at" timestamptz
);

CREATE TABLE "signed_prekeys" (
  "id" uuid PRIMARY KEY NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "key_id" integer NOT NULL,
  "public_key" bytea NOT NULL,
  "signature" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "signed_prekeys_device_id_unique" UNIQUE ("device_id")
);

CREATE TABLE "one_time_prekeys" (
  "id" uuid PRIMARY KEY NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "key_id" integer NOT NULL,
  "public_key" bytea NOT NULL,
  "created_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "claim_receipt_id" uuid,
  CONSTRAINT "one_time_prekeys_device_key_unique" UNIQUE ("device_id", "key_id")
);

CREATE TABLE "conversations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "conversations_kind_check" CHECK ("kind" IN ('direct', 'group'))
);

CREATE TABLE "conversation_members" (
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id"),
  "member_device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "role" text NOT NULL,
  "joined_at" timestamptz NOT NULL,
  "left_at" timestamptz,
  CONSTRAINT "conversation_members_pk" PRIMARY KEY ("conversation_id", "member_device_id")
);

CREATE TABLE "mailbox_messages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "recipient_device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "conversation_id" uuid REFERENCES "conversations"("id"),
  "sender_device_id" uuid REFERENCES "devices"("id"),
  "envelope" bytea NOT NULL,
  "enqueued_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "status" text NOT NULL,
  "acked_at" timestamptz,
  "attempt_count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "mailbox_messages_status_check"
    CHECK ("status" IN ('queued', 'delivered', 'acked', 'expired', 'dead'))
);

CREATE TABLE "delivery_receipts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "mailbox_messages"("id"),
  "recipient_device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "sender_device_id" uuid REFERENCES "devices"("id"),
  "state" text NOT NULL,
  "receipt_at" timestamptz NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "delivery_receipts_state_check" CHECK ("state" IN ('delivered', 'read', 'failed'))
);

CREATE TABLE "attachments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "owner_device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "storage_key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "content_type" text NOT NULL,
  "digest_sha256" bytea NOT NULL,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);

CREATE TABLE "sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "token_hash" bytea NOT NULL,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "last_used_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "client_info" jsonb NOT NULL,
  CONSTRAINT "sessions_token_hash_unique" UNIQUE ("token_hash")
);

CREATE TABLE "push_endpoints" (
  "id" uuid PRIMARY KEY NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "devices"("id"),
  "provider" text NOT NULL,
  "endpoint_ciphertext" bytea NOT NULL,
  "endpoint_hash" bytea NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  "disabled_at" timestamptz,
  CONSTRAINT "push_endpoints_provider_check" CHECK ("provider" IN ('apns', 'fcm', 'webpush'))
);

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY NOT NULL,
  "event_time" timestamptz NOT NULL,
  "actor_pseudonym" bytea NOT NULL,
  "device_id" uuid REFERENCES "devices"("id"),
  "event_type" text NOT NULL,
  "outcome" text NOT NULL,
  "target_type" text,
  "target_id" uuid,
  "metadata" jsonb NOT NULL,
  "request_id" uuid
);

CREATE TABLE "service_metrics" (
  "id" uuid PRIMARY KEY NOT NULL,
  "bucket_start" timestamptz NOT NULL,
  "bucket_size" interval NOT NULL,
  "metric_name" text NOT NULL,
  "dimensions" jsonb NOT NULL,
  "value_double" double precision,
  "value_bigint" bigint,
  "sample_count" bigint NOT NULL,
  CONSTRAINT "service_metrics_name_bucket_dimensions_unique"
    UNIQUE ("metric_name", "bucket_start", "dimensions")
);

CREATE INDEX "devices_user_revoked_idx" ON "devices" ("user_id", "revoked_at");
CREATE INDEX "signed_prekeys_device_expiry_created_idx"
  ON "signed_prekeys" ("device_id", "expires_at" DESC, "created_at" DESC);
CREATE INDEX "one_time_prekeys_unclaimed_device_created_idx"
  ON "one_time_prekeys" ("device_id", "created_at", "claimed_at")
  WHERE "claimed_at" IS NULL;
CREATE INDEX "conversation_members_device_left_idx"
  ON "conversation_members" ("member_device_id", "left_at");
CREATE INDEX "mailbox_messages_queued_recipient_enqueued_idx"
  ON "mailbox_messages" ("recipient_device_id", "status", "enqueued_at")
  WHERE "status" = 'queued';
CREATE INDEX "mailbox_messages_expiry_nonterminal_idx"
  ON "mailbox_messages" ("expires_at")
  WHERE "status" NOT IN ('acked', 'expired', 'dead');
CREATE INDEX "delivery_receipts_message_idx" ON "delivery_receipts" ("message_id");
CREATE INDEX "delivery_receipts_sender_time_idx"
  ON "delivery_receipts" ("sender_device_id", "receipt_at" DESC);
CREATE INDEX "attachments_owner_deleted_idx" ON "attachments" ("owner_device_id", "deleted_at");
CREATE INDEX "sessions_device_revoked_idx" ON "sessions" ("device_id", "revoked_at");
CREATE INDEX "push_endpoints_device_disabled_idx" ON "push_endpoints" ("device_id", "disabled_at");
CREATE INDEX "audit_events_time_idx" ON "audit_events" ("event_time" DESC);
CREATE INDEX "audit_events_type_time_idx" ON "audit_events" ("event_type", "event_time" DESC);
CREATE INDEX "audit_events_actor_time_idx"
  ON "audit_events" ("actor_pseudonym", "event_time" DESC);
CREATE INDEX "service_metrics_name_bucket_idx"
  ON "service_metrics" ("metric_name", "bucket_start" DESC);

COMMENT ON TABLE "users" IS 'Purpose=account state; retention=account deletion workflow; access=primary key; identifies_person=yes';
COMMENT ON COLUMN "users"."id" IS 'Purpose=account identifier; retention=account deletion workflow; access=primary key; identifies_person=yes';
COMMENT ON COLUMN "users"."created_at" IS 'Purpose=account creation time; retention=account deletion workflow; access=primary key row; identifies_person=indirect';
COMMENT ON COLUMN "users"."status" IS 'Purpose=account lifecycle state; retention=account deletion workflow; access=account row; identifies_person=indirect';
COMMENT ON COLUMN "users"."deleted_at" IS 'Purpose=account deletion marker; retention=account deletion workflow; access=account row; identifies_person=indirect';

COMMENT ON TABLE "devices" IS 'Purpose=registered device state; retention=revocation and account deletion workflow; access=user_id and revoked_at; identifies_person=indirect';
COMMENT ON COLUMN "devices"."id" IS 'Purpose=device identifier; retention=revocation and account deletion workflow; access=primary key and foreign keys; identifies_person=indirect';
COMMENT ON COLUMN "devices"."user_id" IS 'Purpose=device owner link; retention=revocation and account deletion workflow; access=devices_user_revoked_idx; identifies_person=yes';
COMMENT ON COLUMN "devices"."created_at" IS 'Purpose=device registration time; retention=revocation and account deletion workflow; access=user_id; identifies_person=indirect';
COMMENT ON COLUMN "devices"."last_seen_at" IS 'Purpose=last activity time; retention=revocation and account deletion workflow; access=device row; identifies_person=indirect';
COMMENT ON COLUMN "devices"."revoked_at" IS 'Purpose=device revocation time; retention=revocation and account deletion workflow; access=devices_user_revoked_idx; identifies_person=indirect';

COMMENT ON TABLE "device_identity_keys" IS 'Purpose=public identity key per device; retention=key rotation and device deletion workflow; access=device_id primary key; identifies_person=indirect';
COMMENT ON COLUMN "device_identity_keys"."device_id" IS 'Purpose=key owner device; retention=key rotation and device deletion workflow; access=primary key and devices foreign key; identifies_person=indirect';
COMMENT ON COLUMN "device_identity_keys"."public_key" IS 'Purpose=public device identity key; retention=until key rotation or device deletion; access=device_id; identifies_person=indirect';
COMMENT ON COLUMN "device_identity_keys"."algorithm" IS 'Purpose=public key algorithm label; retention=until key rotation or device deletion; access=device_id; identifies_person=no';
COMMENT ON COLUMN "device_identity_keys"."created_at" IS 'Purpose=key creation time; retention=until key rotation or device deletion; access=device_id; identifies_person=indirect';
COMMENT ON COLUMN "device_identity_keys"."rotated_at" IS 'Purpose=key rotation time; retention=until device deletion; access=device_id; identifies_person=indirect';

COMMENT ON TABLE "signed_prekeys" IS 'Purpose=published signed key material; retention=until expiry and key cleanup; access=device_id and expiry ordering; identifies_person=indirect';
COMMENT ON COLUMN "signed_prekeys"."id" IS 'Purpose=signed prekey row identifier; retention=until expiry and key cleanup; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "signed_prekeys"."device_id" IS 'Purpose=prekey owner device; retention=until expiry and key cleanup; access=signed_prekeys_device_expiry_created_idx; identifies_person=indirect';
COMMENT ON COLUMN "signed_prekeys"."key_id" IS 'Purpose=client key slot identifier; retention=until expiry and key cleanup; access=device_id; identifies_person=no';
COMMENT ON COLUMN "signed_prekeys"."public_key" IS 'Purpose=public signed prekey; retention=until expiry and key cleanup; access=device_id; identifies_person=indirect';
COMMENT ON COLUMN "signed_prekeys"."signature" IS 'Purpose=signature over public prekey; retention=until expiry and key cleanup; access=device_id; identifies_person=indirect';
COMMENT ON COLUMN "signed_prekeys"."expires_at" IS 'Purpose=prekey validity deadline; retention=until expiry and key cleanup; access=signed_prekeys_device_expiry_created_idx; identifies_person=no';
COMMENT ON COLUMN "signed_prekeys"."created_at" IS 'Purpose=prekey publication time; retention=until expiry and key cleanup; access=signed_prekeys_device_expiry_created_idx; identifies_person=indirect';

COMMENT ON TABLE "one_time_prekeys" IS 'Purpose=claimable public one-time keys; retention=until claim or device key cleanup; access=device_id and unclaimed partial index; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."id" IS 'Purpose=prekey row identifier; retention=until claim or device key cleanup; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."device_id" IS 'Purpose=prekey owner device; retention=until claim or device key cleanup; access=unclaimed partial index; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."key_id" IS 'Purpose=client key slot identifier; retention=until claim or device key cleanup; access=device_id and unique key; identifies_person=no';
COMMENT ON COLUMN "one_time_prekeys"."public_key" IS 'Purpose=public one-time key material; retention=until claim or device key cleanup; access=device_id; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."created_at" IS 'Purpose=prekey upload time and claim ordering; retention=until claim or device key cleanup; access=unclaimed partial index; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."claimed_at" IS 'Purpose=claim completion time; retention=until claim receipt cleanup; access=unclaimed partial index; identifies_person=indirect';
COMMENT ON COLUMN "one_time_prekeys"."claim_receipt_id" IS 'Purpose=claim receipt correlation; retention=until claim receipt cleanup; access=prekey row; identifies_person=indirect';

COMMENT ON TABLE "conversations" IS 'Purpose=conversation lifecycle metadata; retention=conversation deletion workflow; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "conversations"."id" IS 'Purpose=conversation identifier; retention=conversation deletion workflow; access=primary key and foreign keys; identifies_person=indirect';
COMMENT ON COLUMN "conversations"."kind" IS 'Purpose=direct or group conversation classification; retention=conversation deletion workflow; access=conversation row; identifies_person=no';
COMMENT ON COLUMN "conversations"."created_at" IS 'Purpose=conversation creation time; retention=conversation deletion workflow; access=conversation row; identifies_person=indirect';
COMMENT ON COLUMN "conversations"."deleted_at" IS 'Purpose=conversation deletion marker; retention=conversation deletion workflow; access=conversation row; identifies_person=indirect';

COMMENT ON TABLE "conversation_members" IS 'Purpose=device membership and role; retention=conversation deletion workflow; access=conversation primary key and member device index; identifies_person=indirect';
COMMENT ON COLUMN "conversation_members"."conversation_id" IS 'Purpose=conversation membership key; retention=conversation deletion workflow; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "conversation_members"."member_device_id" IS 'Purpose=member device link; retention=conversation deletion workflow; access=conversation primary key and conversation_members_device_left_idx; identifies_person=indirect';
COMMENT ON COLUMN "conversation_members"."role" IS 'Purpose=membership permission label; retention=conversation deletion workflow; access=conversation primary key; identifies_person=no';
COMMENT ON COLUMN "conversation_members"."joined_at" IS 'Purpose=membership start time; retention=conversation deletion workflow; access=conversation primary key; identifies_person=indirect';
COMMENT ON COLUMN "conversation_members"."left_at" IS 'Purpose=membership end time; retention=conversation deletion workflow; access=conversation_members_device_left_idx; identifies_person=indirect';

COMMENT ON TABLE "mailbox_messages" IS 'Purpose=temporary end-to-end encrypted message envelopes; retention=expires_at and acknowledgement cleanup; access=recipient queued index and expiry index; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."id" IS 'Purpose=mailbox row identifier; retention=expires_at and acknowledgement cleanup; access=primary key and receipt foreign key; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."recipient_device_id" IS 'Purpose=message destination device; retention=expires_at and acknowledgement cleanup; access=mailbox_messages_queued_recipient_enqueued_idx; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."conversation_id" IS 'Purpose=optional conversation link; retention=expires_at and acknowledgement cleanup; access=message row; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."sender_device_id" IS 'Purpose=message source device; retention=expires_at and acknowledgement cleanup; access=message row; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."envelope" IS 'Purpose=opaque encrypted message payload; retention=expires_at or acknowledgement cleanup; access=recipient queued index selects row; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."enqueued_at" IS 'Purpose=mailbox ordering time; retention=expires_at and acknowledgement cleanup; access=mailbox_messages_queued_recipient_enqueued_idx; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."expires_at" IS 'Purpose=message expiry deadline; retention=purge at expiry; access=mailbox_messages_expiry_nonterminal_idx; identifies_person=no';
COMMENT ON COLUMN "mailbox_messages"."status" IS 'Purpose=delivery lifecycle state; retention=expires_at and acknowledgement cleanup; access=mailbox_messages_queued_recipient_enqueued_idx; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."acked_at" IS 'Purpose=client acknowledgement time; retention=expires_at and acknowledgement cleanup; access=message row; identifies_person=indirect';
COMMENT ON COLUMN "mailbox_messages"."attempt_count" IS 'Purpose=delivery retry count; retention=expires_at and acknowledgement cleanup; access=message row; identifies_person=no';

COMMENT ON TABLE "delivery_receipts" IS 'Purpose=message delivery state receipts; retention=receipt retention policy; access=message and sender-time indexes; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."id" IS 'Purpose=receipt identifier; retention=receipt retention policy; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."message_id" IS 'Purpose=receipt message link; retention=receipt retention policy; access=delivery_receipts_message_idx; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."recipient_device_id" IS 'Purpose=receipt recipient; retention=receipt retention policy; access=receipt row; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."sender_device_id" IS 'Purpose=receipt sender; retention=receipt retention policy; access=delivery_receipts_sender_time_idx; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."state" IS 'Purpose=delivery outcome; retention=receipt retention policy; access=message and sender-time indexes; identifies_person=no';
COMMENT ON COLUMN "delivery_receipts"."receipt_at" IS 'Purpose=receipt event time; retention=receipt retention policy; access=delivery_receipts_sender_time_idx; identifies_person=indirect';
COMMENT ON COLUMN "delivery_receipts"."metadata" IS 'Purpose=bounded receipt attributes only; retention=receipt retention policy; access=receipt row; identifies_person=indirect';

COMMENT ON TABLE "attachments" IS 'Purpose=attachment storage metadata; retention=expires_at and deletion workflow; access=owner device index; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."id" IS 'Purpose=attachment identifier; retention=expires_at and deletion workflow; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."owner_device_id" IS 'Purpose=attachment owner device; retention=expires_at and deletion workflow; access=attachments_owner_deleted_idx; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."storage_key" IS 'Purpose=opaque object storage locator; retention=expires_at and deletion workflow; access=attachment row for storage lookup; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."size_bytes" IS 'Purpose=stored object size; retention=expires_at and deletion workflow; access=attachment row; identifies_person=no';
COMMENT ON COLUMN "attachments"."content_type" IS 'Purpose=declared media type; retention=expires_at and deletion workflow; access=attachment row; identifies_person=no';
COMMENT ON COLUMN "attachments"."digest_sha256" IS 'Purpose=object integrity digest; retention=expires_at and deletion workflow; access=attachment row; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."created_at" IS 'Purpose=object creation time; retention=expires_at and deletion workflow; access=owner device index; identifies_person=indirect';
COMMENT ON COLUMN "attachments"."expires_at" IS 'Purpose=object expiration deadline; retention=purge at expiry; access=attachment row; identifies_person=no';
COMMENT ON COLUMN "attachments"."deleted_at" IS 'Purpose=object deletion marker; retention=deletion workflow; access=attachments_owner_deleted_idx; identifies_person=indirect';

COMMENT ON TABLE "sessions" IS 'Purpose=hashed session authentication state; retention=expiry or revocation cleanup; access=unique token hash and device index; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."id" IS 'Purpose=session identifier; retention=expiry or revocation cleanup; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."device_id" IS 'Purpose=session device link; retention=expiry or revocation cleanup; access=sessions_device_revoked_idx; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."token_hash" IS 'Purpose=non-reversible session token lookup; retention=expiry or revocation cleanup; access=sessions_token_hash_unique; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."created_at" IS 'Purpose=session creation time; retention=expiry or revocation cleanup; access=device index; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."expires_at" IS 'Purpose=session expiry deadline; retention=purge after expiry; access=session row; identifies_person=no';
COMMENT ON COLUMN "sessions"."last_used_at" IS 'Purpose=last authenticated use; retention=expiry or revocation cleanup; access=session row; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."revoked_at" IS 'Purpose=session revocation time; retention=expiry or revocation cleanup; access=sessions_device_revoked_idx; identifies_person=indirect';
COMMENT ON COLUMN "sessions"."client_info" IS 'Purpose=bounded client context; retention=expiry or revocation cleanup; access=session row; identifies_person=indirect';

COMMENT ON TABLE "push_endpoints" IS 'Purpose=encrypted push delivery address; retention=until disabled or device deletion; access=device and disabled state; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."id" IS 'Purpose=push endpoint row identifier; retention=until disabled or device deletion; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."device_id" IS 'Purpose=endpoint owner device; retention=until disabled or device deletion; access=push_endpoints_device_disabled_idx; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."provider" IS 'Purpose=push provider selector; retention=until disabled or device deletion; access=device index; identifies_person=no';
COMMENT ON COLUMN "push_endpoints"."endpoint_ciphertext" IS 'Purpose=encrypted provider endpoint; retention=until disabled or device deletion; access=push endpoint row; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."endpoint_hash" IS 'Purpose=endpoint deduplication and lookup hash; retention=until disabled or device deletion; access=push endpoint row; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."created_at" IS 'Purpose=endpoint registration time; retention=until disabled or device deletion; access=device index; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."updated_at" IS 'Purpose=endpoint update time; retention=until disabled or device deletion; access=device index; identifies_person=indirect';
COMMENT ON COLUMN "push_endpoints"."disabled_at" IS 'Purpose=endpoint disable marker; retention=deletion workflow; access=push_endpoints_device_disabled_idx; identifies_person=indirect';

COMMENT ON TABLE "audit_events" IS 'Purpose=security and administrative event trail; retention=operator audit retention policy; access=time, type-time, actor-time indexes; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."id" IS 'Purpose=audit event identifier; retention=operator audit retention policy; access=primary key; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."event_time" IS 'Purpose=event occurrence time; retention=operator audit retention policy; access=audit_events_time_idx and type-time index; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."actor_pseudonym" IS 'Purpose=pseudonymous actor lookup; retention=operator audit retention policy; access=audit_events_actor_time_idx; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."device_id" IS 'Purpose=optional device context; retention=operator audit retention policy; access=event time indexes; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."event_type" IS 'Purpose=event classification; retention=operator audit retention policy; access=audit_events_type_time_idx; identifies_person=no';
COMMENT ON COLUMN "audit_events"."outcome" IS 'Purpose=event result; retention=operator audit retention policy; access=event type and time; identifies_person=no';
COMMENT ON COLUMN "audit_events"."target_type" IS 'Purpose=target entity classification; retention=operator audit retention policy; access=event type and time; identifies_person=no';
COMMENT ON COLUMN "audit_events"."target_id" IS 'Purpose=optional target entity link; retention=operator audit retention policy; access=event row; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."metadata" IS 'Purpose=bounded redacted event attributes; retention=operator audit retention policy; access=event row; identifies_person=indirect';
COMMENT ON COLUMN "audit_events"."request_id" IS 'Purpose=request correlation identifier; retention=operator audit retention policy; access=event row; identifies_person=indirect';

COMMENT ON TABLE "service_metrics" IS 'Purpose=aggregated service measurements; retention=operator metrics retention policy; access=metric and bucket index; identifies_person=indirect';
COMMENT ON COLUMN "service_metrics"."id" IS 'Purpose=metric bucket row identifier; retention=operator metrics retention policy; access=primary key; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."bucket_start" IS 'Purpose=aggregation window start; retention=operator metrics retention policy; access=service_metrics_name_bucket_idx; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."bucket_size" IS 'Purpose=aggregation window duration; retention=operator metrics retention policy; access=metric row; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."metric_name" IS 'Purpose=measurement name; retention=operator metrics retention policy; access=service_metrics_name_bucket_idx; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."dimensions" IS 'Purpose=bounded aggregate dimensions without identifiers; retention=operator metrics retention policy; access=unique metric bucket and metric index; identifies_person=indirect';
COMMENT ON COLUMN "service_metrics"."value_double" IS 'Purpose=optional floating-point aggregate; retention=operator metrics retention policy; access=metric row; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."value_bigint" IS 'Purpose=optional integer aggregate; retention=operator metrics retention policy; access=metric row; identifies_person=no';
COMMENT ON COLUMN "service_metrics"."sample_count" IS 'Purpose=aggregate sample count; retention=operator metrics retention policy; access=metric row; identifies_person=no';
