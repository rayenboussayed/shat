/**
 * Ghost Mode keeps message content in volatile memory only.
 *
 * Limits and guarantees:
 * - Message content is never written to localStorage, sessionStorage,
 *   IndexedDB, cookies, or any other persistent store.
 * - Content lives only in in-memory React state for the lifetime of the page.
 * - On reload or navigation away, in-memory content is discarded.
 * - No analytics or telemetry may include message content.
 */
/** Default value for Ghost Mode (enabled). */
export const GHOST_MODE_DEFAULT = true;

/** Returns whether Ghost Mode is enabled, defaulting to on. */
export function isGhostModeEnabled(value: boolean | undefined): boolean {
  return value ?? GHOST_MODE_DEFAULT;
}
