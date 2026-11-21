import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../src/app.js";
import { AppModule } from "../../src/app.module.js";
import { AuthService } from "../../src/identity/auth.service.js";
import { DatabaseService } from "../../src/db/db.js";
import { mailboxMessages, conversations, conversationMembers, deliveryReceipts } from "../../src/db/db.js";

const validToken = randomBytes(32).toString("base64url");
const recipientToken = randomBytes(32).toString("base64url");
const validDeviceId = randomUUID();
const validUserId = randomUUID();
const validSessionId = randomUUID();
const recipientDeviceId = randomUUID();

const mockMessageRow = {
  id: randomUUID(),
  recipientDeviceId,
  conversationId: null,
  senderDeviceId: validDeviceId,
  envelope: Buffer.alloc(4),
  enqueuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  status: "queued",
  ackedAt: null,
  attemptCount: 0,
};

const mockAuth = {
  getAuthenticatedActor: async (headers: { authorization?: string }) => {
    if (headers.authorization === `Bearer ${validToken}`) {
      return { id: validDeviceId, userId: validUserId, sessionId: validSessionId, tokenHash: Buffer.alloc(0) };
    }
    if (headers.authorization === `Bearer ${recipientToken}`) {
      return { id: recipientDeviceId, userId: validUserId, sessionId: validSessionId, tokenHash: Buffer.alloc(0) };
    }
    return undefined;
  },
  getActiveDevice: async (id: string) => ({ id, userId: validUserId }),
};

const mockDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === mailboxMessages) return [mockMessageRow];
          if (table === conversations) return [{ id: randomUUID() }];
          if (table === conversationMembers) return [];
          if (table === deliveryReceipts) return [];
          return [];
        },
        orderBy: () => ({
          limit: async () => {
            if (table === mailboxMessages) return [mockMessageRow];
            return [];
          },
        }),
      }),
      innerJoin: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [], offset: async () => [] }),
          offset: async () => [],
        }),
      }),
    }),
  }),
  transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      insert: () => ({ values: async () => undefined }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => {
              if (table === mailboxMessages) return [mockMessageRow];
              if (table === conversations) return [{ id: randomUUID() }];
              if (table === conversationMembers) return [];
              if (table === deliveryReceipts) return [];
              return [];
            },
          }),
        }),
      }),
    };
    await callback(tx);
    return undefined;
  },
  onApplicationShutdown: async () => undefined,
};

describe("Mailbox and conversation routes (DB-free)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ db: mockDb, onApplicationShutdown: async () => undefined })
      .overrideProvider(AuthService)
      .useValue(mockAuth)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects conversation creation without authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      payload: { recipientDeviceId },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a self-conversation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${validToken}` },
      payload: { recipientDeviceId: validDeviceId },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid UUIDs in conversation creation", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${validToken}` },
      payload: { recipientDeviceId: "not-a-uuid" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("creates a conversation when authenticated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/conversations",
      headers: { authorization: `Bearer ${validToken}` },
      payload: { recipientDeviceId },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().conversationId).toEqual(expect.any(String));
  });

  it("rejects mailbox submission without authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      payload: {
        recipientDeviceId,
        envelope: Buffer.alloc(4).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid envelope", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        recipientDeviceId,
        envelope: "!!!",
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("submits a mailbox envelope when authenticated", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        recipientDeviceId,
        envelope: Buffer.alloc(4).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().status).toBe("queued");
  });

  it("rejects mailbox poll without authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/mailbox" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects delivery receipts without authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/delivery/receipts" });
    expect(response.statusCode).toBe(401);
  });

  it("keeps the mailbox error envelope free of requestId", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).not.toHaveProperty("requestId");
  });

  it("polls queued envelopes for the recipient device", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/mailbox",
      headers: { authorization: `Bearer ${recipientToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().messages)).toBe(true);
  });

  it("acknowledges a mailbox message idempotently", async () => {
    const first = await app.inject({
      method: "POST",
      url: `/mailbox/${mockMessageRow.id}/ack`,
      headers: { authorization: `Bearer ${recipientToken}` },
      payload: { state: "read" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/mailbox/${mockMessageRow.id}/ack`,
      headers: { authorization: `Bearer ${recipientToken}` },
      payload: { state: "read" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it("rejects mailbox submission when recipient is not a conversation member", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mailbox",
      headers: { authorization: `Bearer ${validToken}` },
      payload: {
        recipientDeviceId,
        envelope: Buffer.alloc(4).toString("base64"),
        expiry: new Date(Date.now() + 60_000).toISOString(),
        conversationId: randomUUID(),
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
