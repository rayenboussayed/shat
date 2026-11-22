import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { decodeCanonicalBase64 } from "./encoding.ts";

/** Minimum accepted length of a configured capability signing key, in bytes. */
const MIN_KEY_BYTES = 32;

/** Injection token for the HMAC key that signs download capabilities. */
export const ATTACHMENT_CAPABILITY_KEY = Symbol("ATTACHMENT_CAPABILITY_KEY");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Loads the HMAC key that signs download capabilities. Uses ATTACHMENT_CAPABILITY_KEY
 * (base64, at least 32 bytes) when set; otherwise a random per-process key, so tokens
 * stop working on restart, which is acceptable for their short lifetime.
 */
export function loadCapabilityKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const configured = env.ATTACHMENT_CAPABILITY_KEY;
  if (configured === undefined || configured === "") {
    return randomBytes(MIN_KEY_BYTES);
  }
  const key = decodeCanonicalBase64(configured);
  if (!key || key.length < MIN_KEY_BYTES) {
    throw new Error("ATTACHMENT_CAPABILITY_KEY must decode to at least 32 bytes");
  }
  return key;
}

/** Signs a download capability for one attachment, valid until expiresAtMs. */
export function issueDownloadToken(key: Uint8Array, attachmentId: string, expiresAtMs: number): string {
  const payload = `${attachmentId}.${expiresAtMs}`;
  return `${payload}.${sign(key, payload)}`;
}

/**
 * Verifies a download capability. Returns the attachment identifier only when the
 * signature matches and the token has not expired.
 */
export function verifyDownloadToken(
  key: Uint8Array,
  token: string,
  nowMs: number,
): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [attachmentId, expiry, signature] = parts;
  if (
    attachmentId === undefined ||
    expiry === undefined ||
    signature === undefined ||
    !UUID_PATTERN.test(attachmentId) ||
    !/^\d{1,13}$/.test(expiry)
  ) {
    return undefined;
  }
  const expiresAtMs = Number(expiry);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) {
    return undefined;
  }
  const expected = Buffer.from(sign(key, `${attachmentId}.${expiry}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return undefined;
  }
  return attachmentId;
}

function sign(key: Uint8Array, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}
