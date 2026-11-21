import { describe, it, expect, vi } from "vitest";
import {
  verifySqlCipher,
  openSecureDatabase,
  InMemoryKeyProvider,
} from "../../src/storage/db.ts";

describe("SQLCipher gate", () => {
  it("accepts a non-empty cipher_version", async () => {
    const db = {
      getFirstAsync: vi.fn().mockResolvedValue({ cipher_version: "4.6.1" }),
    };
    await expect(verifySqlCipher(db)).resolves.toBe("4.6.1");
    expect(db.getFirstAsync).toHaveBeenCalledWith("PRAGMA cipher_version");
  });

  it("fails closed when cipher_version is empty", async () => {
    const db = {
      getFirstAsync: vi.fn().mockResolvedValue({ cipher_version: "" }),
    };
    await expect(verifySqlCipher(db)).rejects.toThrow();
  });

  it("fails closed when cipher_version is whitespace only", async () => {
    const db = {
      getFirstAsync: vi.fn().mockResolvedValue({ cipher_version: "   " }),
    };
    await expect(verifySqlCipher(db)).rejects.toThrow();
  });

  it("fails closed when no row is returned", async () => {
    const db = {
      getFirstAsync: vi.fn().mockResolvedValue(null),
    };
    await expect(verifySqlCipher(db)).rejects.toThrow();
  });

  it("accepts an execAsync result array", async () => {
    const db = {
      execAsync: vi.fn().mockResolvedValue([{ cipher_version: "4.6.1" }]),
    };
    await expect(verifySqlCipher(db)).resolves.toBe("4.6.1");
  });

  it("fails closed when execAsync reports no version", async () => {
    const db = {
      execAsync: vi.fn().mockResolvedValue([]),
    };
    await expect(verifySqlCipher(db)).rejects.toThrow();
  });
});

describe("openSecureDatabase", () => {
  it("applies the key before verification", async () => {
    const db = {
      execAsync: vi.fn().mockResolvedValue({ cipher_version: "4.6.1" }),
      closeAsync: vi.fn(),
    };
    const provider = new InMemoryKeyProvider("secret'quote");
    const opened = await openSecureDatabase("test.db", provider, async () => db);
    expect(opened).toBe(db);
    expect(db.execAsync).toHaveBeenNthCalledWith(1, "PRAGMA key = 'secret''quote'");
    expect(db.execAsync).toHaveBeenNthCalledWith(2, "PRAGMA cipher_version");
  });

  it("closes the handle when verification fails", async () => {
    const db = {
      execAsync: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
      closeAsync: vi.fn(),
    };
    const provider = new InMemoryKeyProvider("key");
    await expect(openSecureDatabase("test.db", provider, async () => db)).rejects.toThrow();
    expect(db.closeAsync).toHaveBeenCalled();
  });

  it("closes the handle via close when closeAsync is absent", async () => {
    const db = {
      execAsync: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([]),
      close: vi.fn(),
    };
    const provider = new InMemoryKeyProvider("key");
    await expect(openSecureDatabase("test.db", provider, async () => db)).rejects.toThrow();
    expect(db.close).toHaveBeenCalled();
  });
});
