import { describe, expect, test } from "vitest";

import { DatabaseService } from "../../src/db/db.ts";
import { AuthService } from "../../src/identity/auth.service.ts";
import { sha256 } from "../../src/encoding.ts";

/** Directory holding the committed per-benchmark baseline artifacts. */
const BASELINE_DIR = "./apps/backend/test/perf/baselines";

/** Minimum current/baseline throughput ratio: a slowdown over 5% fails. */
const THROUGHPUT_RATIO_FLOOR = 0.95;

/**
 * Registers a benchmark that either refreshes its committed baseline artifact
 * (when VITE_WRITE_BENCH is set) or compares the current throughput against it.
 */
function regressionBench(
  name: string,
  artifact: string,
  task: () => void,
  assert: () => void,
): void {
  const baselinePath = `${BASELINE_DIR}/${artifact}.json`;
  test(name, { retry: 3 }, async ({ bench }) => {
    if (process.env.VITE_WRITE_BENCH) {
      // Refresh mode: run the benchmark and let writeResult commit the artifact.
      await bench(name, { writeResult: baselinePath }, task).run();
    } else {
      // Compare mode: never writes; bench.from() throws if the artifact is missing.
      const baselineName = `${name} (baseline)`;
      const results = await bench.compare(
        bench(name, task),
        bench.from(baselineName, baselinePath),
      );
      const currentHz = results.get(name).throughput.mean;
      const baselineHz = results.get(baselineName).throughput.mean;
      expect(baselineHz).toBeGreaterThan(0);
      expect(currentHz / baselineHz).toBeGreaterThanOrEqual(THROUGHPUT_RATIO_FLOOR);
    }
    assert();
  });
}

const auth = new AuthService(new DatabaseService());

let lastDecoded: Buffer | undefined;
let lastHashed: Buffer | undefined;
let lastToken: string | undefined;

describe("AuthService.decodeBase64", () => {
  for (const size of [32, 64, 256]) {
    const input = Buffer.alloc(size).toString("base64");
    regressionBench(
      `decode ${size} bytes`,
      `decode-${size}`,
      () => {
        lastDecoded = auth.decodeBase64(input, size);
      },
      () => {
        expect(lastDecoded?.byteLength).toBe(size);
      },
    );
  }
});

describe("AuthService.hashToken", () => {
  for (const size of [32, 256, 1024]) {
    const input = "x".repeat(size);
    regressionBench(
      `hash ${size}-char token`,
      `hash-${size}`,
      () => {
        lastHashed = auth.hashToken(input);
      },
      () => {
        expect(lastHashed?.byteLength).toBe(32);
      },
    );
  }
});

describe("large decode and digest", () => {
  const size = 512 * 1024;
  const input = Buffer.alloc(size, 7).toString("base64");

  regressionBench(
    "decode and digest 512 KiB",
    "decode-digest-512kib",
    () => {
      lastDecoded = auth.decodeBase64(input, size);
      lastHashed = sha256(lastDecoded ?? Buffer.alloc(0));
    },
    () => {
      expect(lastDecoded?.byteLength).toBe(size);
      expect(lastHashed?.byteLength).toBe(32);
    },
  );
});

describe("AuthService.newSessionToken", () => {
  regressionBench(
    "generate session token",
    "session-token",
    () => {
      lastToken = auth.newSessionToken();
    },
    () => {
      expect(lastToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    },
  );
});
