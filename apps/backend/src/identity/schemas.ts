import { base64Schema } from "../encoding.ts";

/** UUID pattern shared by identity and prekey payloads. */
const uuidSchema = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
} as const;

/** Session lifetime used when enrolling a device. */
export const sessionDurationMs = 30 * 24 * 60 * 60 * 1000;

/** JSON Schema for device enrollment requests. */
export const deviceCreateBodySchema = {
  type: "object",
  properties: {
    deviceId: uuidSchema,
    userId: uuidSchema,
    identityPublicKey: base64Schema,
    algorithm: { type: "string", minLength: 1, maxLength: 64 },
  },
  required: ["deviceId", "userId"],
  additionalProperties: false,
} as const;

/** JSON Schema for the device list query string. */
export const devicesQuerySchema = {
  type: "object",
  properties: { userId: uuidSchema },
  required: ["userId"],
  additionalProperties: false,
} as const;

/** JSON Schema for the device id path parameter. */
export const deviceParamsSchema = {
  type: "object",
  properties: { deviceId: uuidSchema },
  required: ["deviceId"],
} as const;

/** JSON Schema for a single device id query. */
export const deviceQuerySchema = {
  type: "object",
  properties: { deviceId: uuidSchema },
  required: ["deviceId"],
  additionalProperties: false,
} as const;

/** JSON Schema for signed prekey publication. */
export const signedPrekeyBodySchema = {
  type: "object",
  properties: {
    keyId: { type: "integer", minimum: 0, maximum: 2147483647 },
    publicKey: base64Schema,
    signature: base64Schema,
    expiresAt: { type: "string", format: "date-time" },
  },
  required: ["keyId", "publicKey", "signature", "expiresAt"],
  additionalProperties: false,
} as const;

/** JSON Schema for a bounded one-time prekey batch. */
export const oneTimePrekeyBodySchema = {
  type: "object",
  properties: {
    prekeys: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        properties: {
          keyId: { type: "integer", minimum: 0, maximum: 2147483647 },
          publicKey: base64Schema,
        },
        required: ["keyId", "publicKey"],
        additionalProperties: false,
      },
    },
  },
  required: ["prekeys"],
  additionalProperties: false,
} as const;

/** JSON Schema for one-time prekey claims. */
export const claimPrekeyBodySchema = {
  type: "object",
  properties: { deviceId: uuidSchema },
  required: ["deviceId"],
  additionalProperties: false,
} as const;



/** Validated body for device enrollment. */
export interface DeviceBody {
  deviceId: string;
  userId: string;
  identityPublicKey?: string;
  algorithm?: string;
}

/** Validated query for listing a user's devices. */
export interface DevicesQuery {
  userId: string;
}

/** Validated path parameters for a device id. */
export interface DeviceParams {
  deviceId: string;
}

/** Validated query containing a single device id. */
export interface DeviceQuery {
  deviceId: string;
}

/** Validated body for publishing a signed prekey. */
export interface PrekeyBody {
  keyId: number;
  publicKey: string;
  signature: string;
  expiresAt: string;
}

/** Validated body for a one-time prekey batch. */
export interface OneTimePrekeyBody {
  prekeys: { keyId: number; publicKey: string }[];
}

/** Authentication and enrollment headers accepted by identity routes. */
export interface SessionHeaders {
  authorization?: string;
  "x-session-token"?: string;
  "x-enrollment-token"?: string;
}

/** Authenticated device derived from a validated session token. */
export interface Actor {
  id: string;
  userId: string;
  sessionId: string;
  tokenHash: Buffer;
}

/** Raw database row returned by an atomic prekey claim. */
export type ClaimedPrekey = Record<string, unknown> & {
  id: string;
  device_id: string;
  key_id: number;
  public_key: Buffer;
  created_at: Date;
  claimed_at: Date;
  claim_receipt_id: string;
};

/** Status code and body produced by an identity service. */
export interface IdentityResult {
  status: number;
  body: unknown;
}