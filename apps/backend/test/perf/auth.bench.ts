import { describe, expect, test } from "vitest";

import { DatabaseService } from "../../src/db/db.ts";
import { AuthService } from "../../src/identity/auth.service.ts";

const auth = new AuthService(new DatabaseService());

let lastDecoded: Buffer | undefined;
let lastHashed: Buffer | undefined;
let lastToken: string | undefined;

describe("AuthService.decodeBase64", () => {
  for (const size of [32, 64, 256]) {
    const input = Buffer.alloc(size).toString("base64");
    test(`decode ${size} bytes`, async ({ bench }) => {
      await bench(`decode ${size} bytes`, () => {
        lastDecoded = auth.decodeBase64(input, size);
      }).run();
      expect(lastDecoded?.byteLength).toBe(size);
    });
  }
});

describe("AuthService.hashToken", () => {
  for (const size of [32, 256, 1024]) {
    const input = "x".repeat(size);
    test(`hash ${size}-char token`, async ({ bench }) => {
      await bench(`hash ${size}-char token`, () => {
        lastHashed = auth.hashToken(input);
      }).run();
      expect(lastHashed?.byteLength).toBe(32);
    });
  }
});

describe("AuthService.newSessionToken", () => {
  test("generate session token", async ({ bench }) => {
    await bench("generate session token", () => {
      lastToken = auth.newSessionToken();
    }).run();
    expect(lastToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
