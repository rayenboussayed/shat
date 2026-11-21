import type { paths } from "shat-api-types";

/**
 * Backend route paths declared in the generated OpenAPI types. Typed against
 * `paths` so the list cannot drift from the generated contract unnoticed.
 */
export const BACKEND_ROUTES: readonly (keyof paths & string)[] = [
  "/health",
  "/identity/devices",
  "/identity/devices/{deviceId}/revoke",
  "/identity/device",
  "/prekeys/publish",
  "/prekeys/one-time",
  "/prekeys/claim",
  "/prekeys/signed",
  "/conversations",
  "/mailbox",
  "/mailbox/{id}/ack",
  "/delivery/receipts",
] as const;