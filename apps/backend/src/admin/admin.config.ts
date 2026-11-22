import { SECRET_MIN_LENGTH, readSecretEnv } from "./env-secret.ts";

/** Injection token for the admin configuration resolved from the environment. */
export const ADMIN_CONFIG = Symbol("ADMIN_CONFIG");

/** Resolved admin settings. `token` is undefined when unset or weak, so admin routes fail closed. */
export interface AdminConfig {
  readonly token: string | undefined;
}

/** Reads SHAT_ADMIN_TOKEN from the environment; a missing or weak token disables admin routes. */
export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  return { token: readSecretEnv(env, "SHAT_ADMIN_TOKEN", SECRET_MIN_LENGTH) };
}
