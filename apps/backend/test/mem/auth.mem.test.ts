import { describe, expect, it } from "vitest";

import { DatabaseService } from "../../src/db/db.ts";
import { AuthService } from "../../src/identity/auth.service.ts";

/** Heap growth must stay below 95% of the absolute cap, a tighter bound than the cap itself. */
const HEAP_RATIO_TOLERANCE = 0.95;

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
      // Tighter bound than the absolute cap: retained growth must stay inside
      // the 0.95 band so a near-cap result fails.
      expect((after - before) / (32 * 1024 * 1024)).toBeLessThanOrEqual(HEAP_RATIO_TOLERANCE);
    }
  });

  it("does not retain hashed tokens beyond a bound", () => {
    const auth = new AuthService(new DatabaseService());
    collect();
    const before = process.memoryUsage().heapUsed;
    let lastHash: Buffer | undefined;
    for (let index = 0; index < 20_000; index += 1) {
      lastHash = auth.hashToken(`token-${index}`);
    }
    collect();
    const after = process.memoryUsage().heapUsed;
    // Only the last digest is retained, so a leak in the shared helper would still show up here.
    expect(lastHash?.byteLength).toBe(32);
    if (canCollect()) {
      expect(after - before).toBeLessThan(4 * 1024 * 1024);
      expect((after - before) / (4 * 1024 * 1024)).toBeLessThanOrEqual(HEAP_RATIO_TOLERANCE);
    }
  });
});
