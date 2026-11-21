/**
 * Placeholder envelope helpers for the demo messaging UI.
 *
 * Real end-to-end encryption is a deferred decision (spec §21). These helpers
 * produce a clearly labelled placeholder envelope derived from the input bytes so
 * the mailbox flow can be exercised without claiming to be encrypted.
 */

/** Visible label stating that this envelope is a demo, not real E2EE. */
export const DEMO_ENVELOPE_LABEL = "demo / not E2EE";

/**
 * Derives a placeholder envelope from the supplied text by base64-encoding its
 * UTF-8 bytes. This is NOT encryption and must never be described as such.
 *
 * @param input - Plaintext-ish input typed by the user.
 * @returns A base64 string suitable for the mailbox envelope field.
 */
export function derivePlaceholderEnvelope(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}