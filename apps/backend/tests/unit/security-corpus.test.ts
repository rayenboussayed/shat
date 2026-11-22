import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { AppModule } from "../../src/app.module.js";
import { DatabaseService } from "../../src/db/db.js";
import { AuthService } from "../../src/identity/auth.service.js";

const validToken = randomBytes(32).toString("base64url");
const enrollmentToken = randomBytes(32).toString("base64url");
const validDeviceId = randomUUID();
const validUserId = randomUUID();
const validSessionId = randomUUID();

const sessionRow = {
  sessionId: validSessionId,
  tokenHash: createHash("sha256").update(validToken).digest(),
  id: validDeviceId,
  userId: validUserId,
};

const mockDb = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => [sessionRow],
        }),
      }),
      where: () => ({
        limit: () => [],
      }),
    }),
  }),
  transaction: async () => null,
  onApplicationShutdown: async () => undefined,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("Security corpus (SHAT §19.2, no database)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ db: mockDb, onApplicationShutdown: async () => undefined })
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 400 for a malformed JSON frame", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/identity/devices",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an oversized base64 payload by schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/identity/devices",
      payload: {
        deviceId: randomUUID(),
        userId: randomUUID(),
        identityPublicKey: "A".repeat(9000),
        algorithm: "X25519",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects an empty body and a Unicode device id", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/identity/devices",
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const unicode = await app.inject({
      method: "POST",
      url: "/identity/devices",
      payload: { deviceId: "装置-😀", userId: randomUUID() },
    });
    expect(unicode.statusCode).toBe(400);
  });

  it("returns 503 when SHAT_ENROLLMENT_TOKEN is missing", async () => {
    const originalToken = process.env.SHAT_ENROLLMENT_TOKEN;
    const originalUser = process.env.SHAT_ENROLLMENT_USER_ID;
    delete process.env.SHAT_ENROLLMENT_TOKEN;
    process.env.SHAT_ENROLLMENT_USER_ID = randomUUID();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentToken },
        payload: { deviceId: randomUUID(), userId: randomUUID() },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      restoreEnv("SHAT_ENROLLMENT_TOKEN", originalToken);
      restoreEnv("SHAT_ENROLLMENT_USER_ID", originalUser);
    }
  });

  it("returns 503 when SHAT_ENROLLMENT_USER_ID is missing", async () => {
    const originalToken = process.env.SHAT_ENROLLMENT_TOKEN;
    const originalUser = process.env.SHAT_ENROLLMENT_USER_ID;
    process.env.SHAT_ENROLLMENT_TOKEN = enrollmentToken;
    delete process.env.SHAT_ENROLLMENT_USER_ID;
    try {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentToken },
        payload: { deviceId: randomUUID(), userId: randomUUID() },
      });
      expect(response.statusCode).toBe(503);
    } finally {
      restoreEnv("SHAT_ENROLLMENT_TOKEN", originalToken);
      restoreEnv("SHAT_ENROLLMENT_USER_ID", originalUser);
    }
  });

  it("rejects an identity key with the wrong decoded byte length", async () => {
    const originalToken = process.env.SHAT_ENROLLMENT_TOKEN;
    const originalUser = process.env.SHAT_ENROLLMENT_USER_ID;
    const enrollmentUserId = randomUUID();
    process.env.SHAT_ENROLLMENT_TOKEN = enrollmentToken;
    process.env.SHAT_ENROLLMENT_USER_ID = enrollmentUserId;
    try {
      const response = await app.inject({
        method: "POST",
        url: "/identity/devices",
        headers: { "x-enrollment-token": enrollmentToken },
        payload: {
          deviceId: randomUUID(),
          userId: enrollmentUserId,
          identityPublicKey: Buffer.alloc(31).toString("base64"),
          algorithm: "X25519",
        },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      restoreEnv("SHAT_ENROLLMENT_TOKEN", originalToken);
      restoreEnv("SHAT_ENROLLMENT_USER_ID", originalUser);
    }
  });

  it("rejects a fabricated session token with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/identity/devices?userId=${randomUUID()}`,
      headers: { authorization: "Bearer fabricated-token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects both session headers supplied at once with 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/identity/devices?userId=${randomUUID()}`,
      headers: {
        "x-session-token": "some-token",
        authorization: "Bearer another-token",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a signed prekey with a wrong-length public key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/prekeys/publish",
      headers: { "x-session-token": validToken },
      payload: {
        keyId: 1,
        publicKey: Buffer.alloc(31).toString("base64"),
        signature: Buffer.alloc(64).toString("base64"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a signed prekey with a wrong-length signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/prekeys/publish",
      headers: { "x-session-token": validToken },
      payload: {
        keyId: 1,
        publicKey: Buffer.alloc(32).toString("base64"),
        signature: Buffer.alloc(63).toString("base64"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a one-time prekey with a wrong-length public key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/prekeys/one-time",
      headers: { "x-session-token": validToken },
      payload: {
        prekeys: [{ keyId: 1, publicKey: Buffer.alloc(31).toString("base64") }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("compares secrets in constant time without throwing", () => {
    const auth = new AuthService(new DatabaseService());
    expect(auth.matchesSecret("short", "a-much-longer-secret")).toBe(false);
    expect(auth.matchesUtf8("abc", "def")).toBe(false);
    expect(auth.matchesUtf8("abc", "abcd")).toBe(false);
    expect(auth.matchesSecret("x".repeat(10), "y".repeat(10))).toBe(false);
  });

  it("rejects oversized and malformed session tokens cleanly", () => {
    const auth = new AuthService(new DatabaseService());
    expect(auth.getSessionToken({ "x-session-token": "A".repeat(2000) })).toBeUndefined();
    expect(auth.getSessionToken({ "x-session-token": "", authorization: "Bearer t" })).toBeUndefined();
    expect(auth.getSessionToken({})).toBeUndefined();
  });

  it("decodes base64 only at the exact byte length", () => {
    const auth = new AuthService(new DatabaseService());
    expect(auth.decodeBase64(Buffer.alloc(31).toString("base64"), 32)).toBeUndefined();
    expect(auth.decodeBase64(Buffer.alloc(32).toString("base64"), 32)).toBeDefined();
    expect(auth.decodeBase64(Buffer.alloc(63).toString("base64"), 64)).toBeUndefined();
    expect(auth.decodeBase64(Buffer.alloc(64).toString("base64"), 64)).toBeDefined();
  });
});
