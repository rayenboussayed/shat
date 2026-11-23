/** Canonical lowercase UUID pattern text, shared by JSON schemas and runtime guards. */
export const UUID_PATTERN_STRING =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/** Canonical lowercase UUID RegExp shared by generated storage keys and capability ids. */
export const UUID_PATTERN = new RegExp(UUID_PATTERN_STRING);
