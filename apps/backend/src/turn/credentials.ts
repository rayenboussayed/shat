import { createHmac } from "node:crypto";

/** Lifetime of an issued TURN credential in seconds. Policy maximum is five minutes. */
export const TURN_CREDENTIAL_TTL_SECONDS = 300;

/**
 * TURN username shape `<expiry>:<deviceId>`. Kept local: its outer anchors and
 * capture group are specific to this format, so it cannot derive from the
 * anchored shared UUID pattern.
 */
const USERNAME_PATTERN =
  /^(\d{1,11}):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** Parsed TURN username: the expiry in Unix seconds and the device it was issued to. */
export interface TurnUsername {
  readonly expiresAtSeconds: number;
  readonly deviceId: string;
}

/**
 * Builds the coturn `use-auth-secret` username for a device: `<expiry>:<deviceId>`.
 * The expiry is part of the signed input, so it cannot be extended without the secret.
 */
export function buildTurnUsername(deviceId: string, expiresAtSeconds: number): string {
  return `${expiresAtSeconds}:${deviceId}`;
}

/** Parses a username built by buildTurnUsername; returns undefined for any other shape. */
export function parseTurnUsername(username: string): TurnUsername | undefined {
  const match = USERNAME_PATTERN.exec(username);
  const expiry = match?.[1];
  const deviceId = match?.[2];
  if (expiry === undefined || deviceId === undefined) {
    return undefined;
  }
  return { expiresAtSeconds: Number(expiry), deviceId };
}

/**
 * Computes the coturn password for a username: base64 of HMAC-SHA1 keyed by the shared
 * secret. SHA-1 is kept only because coturn's REST-secret mechanism verifies this exact
 * MAC; HMAC remains a secure MAC with SHA-1.
 */
export function signTurnUsername(secret: string, username: string): string {
  return createHmac("sha1", secret).update(username).digest("base64");
}
