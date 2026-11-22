/** Hard bounds for attachment uploads, shared by schemas and services. */
export const ATTACHMENT_LIMITS = {
  /** Largest accepted ciphertext blob, in bytes. Fits the 1 MiB Fastify body limit once base64 encoded. */
  maxCiphertextBytes: 512 * 1024,
  /** Longest accepted retention from upload time. */
  maxRetentionMs: 30 * 24 * 60 * 60 * 1000,
  /** Total stored ciphertext bytes allowed per owner device. */
  maxOwnerBytes: 64 * 1024 * 1024,
  /** Lifetime of a download capability token. */
  downloadTokenTtlMs: 60 * 1000,
} as const;

/** Base64 length of the largest ciphertext, with padding. */
const MAX_CIPHERTEXT_BASE64_LENGTH = Math.ceil(ATTACHMENT_LIMITS.maxCiphertextBytes / 3) * 4;

/** UUID pattern shared by attachment identifiers. */
const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

/** JSON Schema for uploading a ciphertext blob. Exact bounds are re-checked in the service. */
export const attachmentCreateBodySchema = {
  type: "object",
  properties: {
    ciphertext: { type: "string", minLength: 4, maxLength: MAX_CIPHERTEXT_BASE64_LENGTH },
    contentType: { type: "string", minLength: 1, maxLength: 128 },
    digestSha256: { type: "string", pattern: "^[A-Za-z0-9+/]{43}=$" },
    expiresAt: { type: "string", format: "date-time" },
  },
  required: ["ciphertext", "contentType", "digestSha256", "expiresAt"],
  additionalProperties: false,
} as const;

/** JSON Schema for the attachment identifier path parameter. */
export const attachmentParamsSchema = {
  type: "object",
  properties: { id: uuidSchema },
  required: ["id"],
  additionalProperties: false,
} as const;

/** JSON Schema for the download capability query. */
export const attachmentDownloadQuerySchema = {
  type: "object",
  properties: {
    token: { type: "string", minLength: 1, maxLength: 512 },
  },
  required: ["token"],
  additionalProperties: false,
} as const;

/** Validated body for uploading a ciphertext blob. */
export interface AttachmentCreateBody {
  ciphertext: string;
  contentType: string;
  digestSha256: string;
  expiresAt: string;
}

/** Validated path parameters for attachment routes. */
export interface AttachmentParams {
  id: string;
}

/** Validated query for the download route. */
export interface AttachmentDownloadQuery {
  token: string;
}

export type { SessionHeaders } from "../identity/schemas.ts";

/** Response for a stored attachment. */
export interface AttachmentCreated {
  id: string;
  expiresAt: string;
}

/** Short-lived capability for downloading one attachment. */
export interface AttachmentCapability {
  id: string;
  downloadToken: string;
  downloadTokenExpiresAt: string;
}
