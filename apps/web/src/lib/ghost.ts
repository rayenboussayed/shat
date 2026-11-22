/**
 * Ghost Mode keeps message content out of LOCAL persistent storage on this
 * device only. This is a local-storage guarantee, not an end-to-end privacy
 * or encryption guarantee.
 *
 * Limits and guarantees:
 * - Message content is never written to localStorage, sessionStorage,
 *   IndexedDB, cookies, or any other LOCAL persistent store on this device.
 * - Content lives only in in-memory React state for the lifetime of the page.
 * - On reload or navigation away, in-memory content is discarded.
 * - No analytics or telemetry may include message content.
 *
 * Sending a message POSTs its envelope to /mailbox, where the server persists
 * it. Ghost Mode avoids local persistence only; it does not prevent the
 * envelope from being transmitted to or stored on the server.
 */
/** Default value for Ghost Mode (enabled). */
export const GHOST_MODE_DEFAULT = true;

/** Returns whether Ghost Mode is enabled, defaulting to on. */
export function isGhostModeEnabled(value: boolean | undefined): boolean {
  return value ?? GHOST_MODE_DEFAULT;
}
