import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Decodes non-empty canonical base64. Rejects non-canonical padding and alphabets so
 * one value has exactly one encoding.
 */
export function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0) {
    return undefined;
  }
  if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    return undefined;
  }
  return decoded;
}

/** SHA-256 digest of a byte buffer. */
export function sha256(bytes: Uint8Array): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/** Compares two digests in constant time. */
export function digestsEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}
