/**
 * Encrypted (ciphertext-only) message storage for the mobile app.
 */

import { verifySqlCipher } from "./db.ts";

/**
 * Default number of messages returned by a list query.
 */
export const DEFAULT_MESSAGE_LIMIT = 50;

/**
 * Maximum number of messages a single list query may return.
 */
export const MAX_MESSAGE_LIMIT = 200;

/**
 * Row shape stored in the messages table.
 */
interface StoredRow {
  id: string;
  conversation_id: string;
  sender_device_id: string | null;
  envelope: string;
  created_at: string;
}

/**
 * Minimal database surface required by the messages repository.
 */
export interface MessagesDatabase {
  getFirstAsync?(source: string, ...params: unknown[]): Promise<unknown | null>;
  execAsync?(source: string, ...params: unknown[]): Promise<unknown>;
  runAsync(source: string, ...params: unknown[]): Promise<{ changes?: number }>;
  getAllAsync(source: string, ...params: unknown[]): Promise<StoredRow[]>;
  closeAsync?(): Promise<void>;
  close?(): void | Promise<void>;
}

export interface StoredMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly envelope: string;
  readonly senderDeviceId: string | null;
  readonly createdAt: string;
}

/**
 * Input payload for inserting a message.
 */
export interface MessageInsert {
  readonly id: string;
  readonly conversationId: string;
  readonly envelope: string;
  readonly senderDeviceId?: string;
  readonly createdAt?: string;
}

/**
 * Repository operations for ciphertext-only messages.
 */
export interface MessagesRepository {
  insert(message: MessageInsert): Promise<void>;
  listByConversation(
    conversationId: string,
    limit?: number,
  ): Promise<readonly StoredMessage[]>;
  deleteByConversation(conversationId: string): Promise<number>;
  deleteById(id: string): Promise<number>;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(Math.trunc(limit), MAX_MESSAGE_LIMIT);
}

function validateInsert(message: MessageInsert): void {
  if (message.id.trim().length === 0) {
    throw new Error("message id is required");
  }
  if (message.conversationId.trim().length === 0) {
    throw new Error("conversation id is required");
  }
  if (message.envelope.trim().length === 0) {
    throw new Error("ciphertext envelope is required");
  }
}

function toStoredMessage(row: StoredRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    envelope: row.envelope,
    senderDeviceId: row.sender_device_id,
    createdAt: row.created_at,
  };
}

/**
 * Default implementation of the messages repository.
 */
export class MessagesRepositoryImpl implements MessagesRepository {
  private readonly db: MessagesDatabase;
  private verified = false;

  constructor(db: MessagesDatabase) {
    this.db = db;
  }

  private async ensureVerified(): Promise<void> {
    if (this.verified) {
      return;
    }
    await verifySqlCipher(this.db);
    this.verified = true;
    const createTableSql =
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_device_id TEXT, envelope TEXT NOT NULL, created_at TEXT NOT NULL)";
    if (typeof this.db.execAsync === "function") {
      await this.db.execAsync(createTableSql);
    } else {
      await this.db.runAsync(createTableSql);
    }
  }

  async insert(message: MessageInsert): Promise<void> {
    validateInsert(message);
    await this.ensureVerified();
    const createdAt = message.createdAt ?? new Date().toISOString();
    await this.db.runAsync(
      "INSERT INTO messages (id, conversation_id, sender_device_id, envelope, created_at) VALUES (?, ?, ?, ?, ?)",
      message.id,
      message.conversationId,
      message.senderDeviceId ?? null,
      message.envelope,
      createdAt,
    );
  }

  async listByConversation(
    conversationId: string,
    limit?: number,
  ): Promise<readonly StoredMessage[]> {
    if (conversationId.trim().length === 0) {
      throw new Error("conversation id is required");
    }
    await this.ensureVerified();
    const bounded = normalizeLimit(limit);
    const rows = await this.db.getAllAsync(
      "SELECT id, conversation_id, sender_device_id, envelope, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?",
      conversationId,
      bounded,
    );
    return rows.map(toStoredMessage);
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    if (conversationId.trim().length === 0) {
      throw new Error("conversation id is required");
    }
    await this.ensureVerified();
    const result = await this.db.runAsync(
      "DELETE FROM messages WHERE conversation_id = ?",
      conversationId,
    );
    return result.changes ?? 0;
  }

  async deleteById(id: string): Promise<number> {
    if (id.trim().length === 0) {
      throw new Error("message id is required");
    }
    await this.ensureVerified();
    const result = await this.db.runAsync("DELETE FROM messages WHERE id = ?", id);
    return result.changes ?? 0;
  }
}

/**
 * Creates a messages repository backed by the given database.
 *
 * @param db - The database handle.
 * @returns A messages repository.
 */
export function createMessagesRepository(db: MessagesDatabase): MessagesRepository {
  return new MessagesRepositoryImpl(db);
}

/**
 * Creates an in-memory messages database for tests and development.
 *
 * @returns A messages database handle.
 */
export function createInMemoryMessagesDatabase(): MessagesDatabase {
  const rows: StoredRow[] = [];

  return {
    async getFirstAsync(source: string): Promise<unknown | null> {
      if (source.toLowerCase().includes("cipher_version")) {
        return { cipher_version: "in-memory" };
      }
      return null;
    },
    async execAsync(): Promise<unknown> {
      return undefined;
    },
    async runAsync(source: string, ...params: unknown[]): Promise<{ changes: number }> {
      const sql = source.toLowerCase();
      if (sql.startsWith("insert into messages")) {
        rows.push({
          id: String(params[0]),
          conversation_id: String(params[1]),
          sender_device_id:
            params[2] === null || params[2] === undefined ? null : String(params[2]),
          envelope: String(params[3]),
          created_at: String(params[4]),
        });
        return { changes: 1 };
      }
      if (sql.startsWith("delete from messages")) {
        const before = rows.length;
        if (sql.includes("conversation_id")) {
          const target = String(params[0]);
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i]?.conversation_id === target) {
              rows.splice(i, 1);
            }
          }
        } else if (sql.includes("where id")) {
          const target = String(params[0]);
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i]?.id === target) {
              rows.splice(i, 1);
            }
          }
        }
        return { changes: before - rows.length };
      }
      return { changes: 0 };
    },
    async getAllAsync(source: string, ...params: unknown[]): Promise<StoredRow[]> {
      const sql = source.toLowerCase();
      if (!sql.includes("from messages")) {
        return [];
      }
      const conversationId = typeof params[0] === "string" ? params[0] : undefined;
      const limit = typeof params[1] === "number" ? params[1] : DEFAULT_MESSAGE_LIMIT;
      let result = rows;
      if (conversationId !== undefined) {
        result = result.filter((row) => row.conversation_id === conversationId);
      }
      result = [...result].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return result.slice(0, limit);
    },
  };
}
