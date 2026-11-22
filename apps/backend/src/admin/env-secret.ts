/** Minimum accepted length of a shared secret read from the environment, in characters. */
export const SECRET_MIN_LENGTH = 32;

/** Minimum number of distinct characters a shared secret must contain. */
const SECRET_MIN_DISTINCT_CHARACTERS = 16;

/**
 * Reads a shared secret from the environment. Returns undefined when the variable is unset,
 * shorter than `minLength`, or made of fewer than 16 distinct characters, so callers fail closed.
 */
export function readSecretEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  minLength: number,
): string | undefined {
  const value = env[name];
  if (
    value === undefined ||
    value.length < minLength ||
    new Set(value).size < SECRET_MIN_DISTINCT_CHARACTERS
  ) {
    return undefined;
  }
  return value;
}
