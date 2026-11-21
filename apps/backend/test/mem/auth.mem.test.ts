import { describe, expect, it } from "vitest";

import { DatabaseService } from "../../src/db/db.ts";
import { AuthService } from "../../src/identity/auth.service.ts";

/** Returns true when an explicit GC cycle can be forced. */
function canCollect(): boolean {
  return typeof global.gc === "function";
}

/** Forces a garbage collection cycle when the runtime exposes one. */
function collect(): void {
  global.gc?.();
}

describe("AuthService memory", () => {
  it("does not retain decoded buffers beyond a bound", () => {
    const auth = new AuthService(new DatabaseService());
    const input = Buffer.alloc(32).toString("base64");
    collect();
    const before = process.memoryUsage().heapUsed;
    let decoded: Buffer | undefined;
    for (let index = 0; index < 100_000; index += 1) {
      decoded = auth.decodeBase64(input, 32);
    }
    collect();
    const after = process.memoryUsage().heapUsed;
    expect(decoded?.byteLength).toBe(32);
    if (canCollect()) {
      expect(after - before).toBeLessThan(32 * 1024 * 1024);
    }
  });

  it("does not retain hashed tokens beyond a bound", () => {
    const auth = new AuthService(new DatabaseService());
    collect();
    const before = process.memoryUsage().heapUsed;
    const values: Buffer[] = [];
    for (let index = 0; index < 20_000; index += 1) {
      values.push(auth.hashToken(`token-${index}`));
    }
    collect();
    const after = process.memoryUsage().heapUsed;
    expect(values.length).toBe(20_000);
    expect(values.at(-1)?.byteLength).toBe(32);
    if (canCollect()) {
      expect(after - before).toBeLessThan(64 * 1024 * 1024);
    }
  });
});
