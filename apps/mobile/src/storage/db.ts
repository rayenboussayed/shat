/**
 * Secure key provider interface. Implementations must never embed a key in
 * source; production implementations read from a platform secure store.
 */
export interface SecureKeyProvider {
  /**
   * Returns the SQLCipher key, or `null` when it is unavailable.
   */
  getKey(): Promise<string | null>;
}

/**
 * Development-only in-memory key provider. It holds no key by default and is
 * documented as unverified on device; it exists only to keep the interface
 * testable without a native secure store.
 */
export class InMemoryKeyProvider implements SecureKeyProvider {
  private readonly key: string | null;

  constructor(key: string | null = null) {
    this.key = key;
  }

  /** @inheritdoc */
  async getKey(): Promise<string | null> {
    return this.key;
  }
}

/**
 * Minimal SQLite surface required by the cipher gate.
 */
export interface SqliteLike {
  getFirstAsync?<T>(source: string): Promise<T | null>;
  execAsync?(source: string): Promise<unknown>;
  closeAsync?(): Promise<void>;
  close?(): void | Promise<void>;
}

/**
 * Extracts a cipher_version string from a variety of SQLite result shapes.
 *
 * @param result - The raw SQLite result.
 * @returns The cipher version, or `undefined` when absent.
 */
function extractCipherVersion(result: unknown): string | undefined {
  if (typeof result === "string") {
    return result.trim().length > 0 ? result : undefined;
  }
  if (Array.isArray(result)) {
    const first = result[0];
    return extractCipherVersion(first);
  }
  if (typeof result === "object" && result !== null) {
    if ("cipher_version" in result) {
      const value = result["cipher_version"];
      if (typeof value === "string") {
        return value.trim().length > 0 ? value : undefined;
      }
      if (Array.isArray(value)) {
        return extractCipherVersion(value);
      }
      if (typeof value === "object" && value !== null) {
        return extractCipherVersion(value);
      }
    }
    if ("rows" in result) {
      const rows = result["rows"];
      if (Array.isArray(rows)) {
        return extractCipherVersion(rows);
      }
      if (typeof rows === "object" && rows !== null) {
        return extractCipherVersion(rows);
      }
    }
  }
  return undefined;
}

/**
 * Verifies that the opened database is backed by SQLCipher by querying
 * `PRAGMA cipher_version`. Fails closed when the pragma is missing or empty.
 *
 * @param db - The SQLite handle to inspect.
 * @returns The non-empty cipher version string.
 * @throws {Error} When SQLCipher is absent or reports no version.
 */
export async function verifySqlCipher(db: SqliteLike): Promise<string> {
  let result: unknown;
  if (typeof db.getFirstAsync === "function") {
    result = await db.getFirstAsync<{ cipher_version?: string }>("PRAGMA cipher_version");
  } else if (typeof db.execAsync === "function") {
    result = await db.execAsync("PRAGMA cipher_version");
  } else {
    throw new Error("SQLite handle does not support querying");
  }
  const version = extractCipherVersion(result);
  if (version === undefined) {
    throw new Error("SQLCipher is not available: PRAGMA cipher_version returned no row");
  }
  return version;
}

/**
 * Closes a SQLite handle when a close method is available, ignoring errors
 * raised during cleanup so the original failure is preserved.
 *
 * @param db - The SQLite handle to close.
 */
async function closeDatabaseHandle(db: SqliteLike): Promise<void> {
  if (typeof db.closeAsync === "function") {
    try {
      await db.closeAsync();
    } catch {
      // Cleanup failure must not mask the original error.
    }
    return;
  }
  if (typeof db.close === "function") {
    try {
      await db.close();
    } catch {
      // Cleanup failure must not mask the original error.
    }
  }
}

/**
 * Opens an Expo SQLite database after applying the SQLCipher key and verifying
 * the SQLCipher gate.
 *
 * The key is applied via `PRAGMA key` before verification. Single quotes in the
 * key are escaped by doubling them. Key application and encryption are only
 * effective when the underlying SQLite build is SQLCipher; this is not verified
 * in this environment.
 *
 * @param name - Database file name.
 * @param keyProvider - Source of the SQLCipher key.
 * @param openDatabase - Injectable opener for tests.
 * @returns The opened, verified database handle.
 */
export async function openSecureDatabase(
  name: string,
  keyProvider: SecureKeyProvider,
  openDatabase: (databaseName: string) => Promise<SqliteLike> = openExpoDatabase,
): Promise<SqliteLike> {
  const key = await keyProvider.getKey();
  if (key === null || key.trim().length === 0) {
    throw new Error("Secure key is unavailable");
  }
  const db = await openDatabase(name);
  try {
    if (typeof db.execAsync !== "function") {
      throw new Error("SQLite handle does not support key application");
    }
    const escapedKey = key.replace(/'/g, "''");
    await db.execAsync(`PRAGMA key = '${escapedKey}'`);
    await verifySqlCipher(db);
  } catch {
    await closeDatabaseHandle(db);
    throw new Error("Secure database setup failed");
  }
  return db;
}

/**
 * Default opener using expo-sqlite. Loaded lazily to avoid native imports in
 * non-native environments.
 *
 * @param databaseName - Database file name.
 * @returns The opened SQLite handle.
 */
async function openExpoDatabase(databaseName: string): Promise<SqliteLike> {
  const sqlite = await import("expo-sqlite");
  return sqlite.openDatabaseAsync(databaseName);
}
