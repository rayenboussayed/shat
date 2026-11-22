import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Injection token for the ciphertext blob store. */
export const ATTACHMENT_STORAGE = Symbol("ATTACHMENT_STORAGE");

/**
 * Stores opaque ciphertext blobs by storage key. Implementations never see plaintext
 * and must reject keys that are not generated identifiers.
 */
export interface AttachmentStorage {
  /** Writes a new blob; fails if the key already exists. */
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** Reads a blob, or undefined when it does not exist. */
  read(key: string): Promise<Buffer | undefined>;
  /** Removes a blob; succeeds when it is already gone. */
  remove(key: string): Promise<void>;
}

const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Local filesystem blob store rooted in a private directory. */
export class FileSystemAttachmentStorage implements AttachmentStorage {
  private readonly root: string;

  /** @param directory - Private directory that holds the blobs; created on first write. */
  constructor(directory: string) {
    this.root = resolve(directory);
  }

  /** Writes a blob with owner-only permissions, refusing to overwrite. */
  async write(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  }

  /** Reads a blob, or undefined when it is missing. */
  async read(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /** Removes a blob, ignoring one that is already gone. */
  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new Error("Attachment storage key is not a generated identifier");
    }
    return join(this.root, key);
  }
}

/** Resolves the blob directory from ATTACHMENT_STORAGE_DIR, defaulting under the working directory. */
export function resolveStorageDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATTACHMENT_STORAGE_DIR ?? join(process.cwd(), "var", "attachments");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
