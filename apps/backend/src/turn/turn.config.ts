import { SECRET_MIN_LENGTH, readSecretEnv } from "../admin/env-secret.ts";

/** Injection token for the TURN configuration resolved from the environment. */
export const TURN_CONFIG = Symbol("TURN_CONFIG");

/** Resolved TURN settings. A missing or weak secret leaves `secret` undefined, so issuance fails closed. */
export interface TurnConfig {
  readonly secret: string | undefined;
  readonly uris: readonly string[];
}

/**
 * Reads TURN settings from the environment. TURN_SECRET is the coturn static-auth-secret;
 * TURN_URIS is a comma-separated list of turn:/turns: URIs handed to clients. Entries that
 * are not TURN URIs are dropped.
 */
export function loadTurnConfig(env: NodeJS.ProcessEnv = process.env): TurnConfig {
  return {
    secret: readSecretEnv(env, "TURN_SECRET", SECRET_MIN_LENGTH),
    uris: (env.TURN_URIS ?? "")
      .split(",")
      .map((uri) => uri.trim())
      .filter((uri) => /^turns?:\S+$/.test(uri)),
  };
}
