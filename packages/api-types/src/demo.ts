/**
 * Shared demo-only constants and the Ghost Mode default.
 *
 * These values are deliberately centralized so the web and mobile clients
 * describe the same placeholder behaviour. Nothing here claims end-to-end
 * encryption or local persistence.
 */

/** Placeholder recipient device id used when no real device is selected. */
export const DEFAULT_RECIPIENT_DEVICE_ID = "00000000-0000-4000-8000-000000000000";

/** Visible label stating that a message is a demo, not real E2EE. */
export const DEMO_ENVELOPE_LABEL = "demo / not E2EE";

/** Status text shown when a send request fails. */
export const SEND_FAILED_STATUS = "Send failed.";

/** Status text shown after a successful demo send. */
export const SEND_SUCCESS_STATUS = "Sent (demo / not E2EE).";

/** Ghost Mode defaults to on: message content stays out of local storage. */
export const GHOST_MODE_DEFAULT = true;

/**
 * Returns whether Ghost Mode is enabled, defaulting to on.
 *
 * @param value - Explicit user setting, or `undefined` for the default.
 * @returns The resolved setting.
 */
export function isGhostModeEnabled(value: boolean | undefined): boolean {
  return value ?? GHOST_MODE_DEFAULT;
}
