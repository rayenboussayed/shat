import { createHash, timingSafeEqual } from "node:crypto";

/** Loose base64 string bounds; exact byte lengths are checked in services. */
export const base64Schema = { type: "string", minLength: 4, maxLength: 8192 } as const;

/**
 * Decodes non-empty canonical base64, optionally bounded by a byte length.
 *
 * Rejects non-canonical padding and alphabets so one value has exactly one
 * encoding. Use `maxBytes` for variable-length payloads such as envelopes.
 *
 * @param value - The base64 string to decode.
 * @param maxBytes - Optional inclusive maximum decoded length.
 * @returns The decoded bytes, or undefined when the input is invalid.
 */
export function decodeCanonicalBase64(value: string, maxBytes?: number): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0) {
    return undefined;
  }
  if (maxBytes !== undefined && decoded.length > maxBytes) {
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
