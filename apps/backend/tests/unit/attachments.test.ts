import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/app.js";
import { AppModule } from "../../src/app.module.js";
import { AttachmentsService } from "../../src/attachments/attachments.service.js";
import { decodeCanonicalBase64, sha256 } from "../../src/encoding.js";
import {
  ATTACHMENT_CAPABILITY_KEY,
  issueDownloadToken,
  loadCapabilityKey,
  verifyDownloadToken,
} from "../../src/attachments/capability.js";
import { ATTACHMENT_LIMITS } from "../../src/attachments/schemas.js";
import {
  ATTACHMENT_STORAGE,
  FileSystemAttachmentStorage,
  type AttachmentStorage,
} from "../../src/attachments/storage.js";
import { AuthService } from "../../src/identity/auth.service.js";
import { DatabaseService } from "../../src/db/db.js";
import { sha256 as trackedSha256 } from "../../src/encoding.js";

// Wrap (do not replace) the shared digest so the single-hash hot path is observable.
vi.mock("../../src/encoding.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/encoding.js")>();
  return { ...actual, sha256: vi.fn(actual.sha256) };
});

const DAY_MS = 24 * 60 * 60 * 1000;
const ownerDeviceId = randomUUID();
const ownerHeaders = { authorization: "Bearer owner-token" };
const CAPABILITY_KEY = randomBytes(32);

interface AttachmentRow {
  id: string;
  ownerDeviceId: string;
  storageKey: string;
  sizeBytes: number;
  contentType: string;
  digestSha256: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
  deletedAt: Date | null;
}

class MemoryStorage implements AttachmentStorage {
  readonly blobs = new Map<string, Buffer>();

  async write(key: string, bytes: Uint8Array): Promise<void> {
    if (this.blobs.has(key)) {
      throw new Error("exists");
    }
    this.blobs.set(key, Buffer.from(bytes));
  }

  async read(key: string): Promise<Buffer | undefined> {
    return this.blobs.get(key);
  }

  async remove(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

interface FakeState {
  liveRow: AttachmentRow | undefined;
  usedBytes: number;
  inserted: Record<string, unknown>[];
  updates: number;
  deletes: number;
}

/**
 * In-memory stand-in for the Drizzle handle. Only the query shapes the service uses
 * are implemented; SQL itself is covered by the DB-gated integration test.
 */
function fakeDatabase(state: FakeState) {
  const rowsFor = (fields?: object): unknown[] => {
    if (fields && "total" in fields) {
      return [{ total: String(state.usedBytes) }];
    }
    return state.liveRow ? [state.liveRow] : [];
  };
  const select = (fields?: object) => ({
    from: () => ({
      where: () => {
        const rows = rowsFor(fields);
        return Object.assign(Promise.resolve(rows), { limit: async () => rows });
      },
    }),
  });
  const tx = {
    execute: async () => undefined,
    select,
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        state.inserted.push(values);
      },
    }),
  };
  return {
    select,
    transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    update: () => ({
      set: () => ({
        where: async () => {
          state.updates += 1;
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deletes += 1;
      },
    }),
  };
}

const liveRowFor = (storageKey: string, bytes: Buffer): AttachmentRow => ({
  id: randomUUID(),
  ownerDeviceId,
  storageKey,
  sizeBytes: bytes.length,
  contentType: "application/octet-stream",
  digestSha256: sha256(bytes),
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + DAY_MS),
  deletedAt: null,
});

function uploadBody(plaintext: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    ciphertext: plaintext.toString("base64"),
    contentType: "application/octet-stream",
    digestSha256: sha256(plaintext).toString("base64"),
    expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    ...overrides,
  };
}

describe("attachment encoding", () => {
  it("accepts canonical base64 and returns the bytes", () => {
    expect(decodeCanonicalBase64("aGVsbG8=")?.toString("utf8")).toBe("hello");
  });

  it("rejects empty, non-alphabet and non-canonical base64", () => {
    expect(decodeCanonicalBase64("")).toBeUndefined();
    expect(decodeCanonicalBase64("a b=")).toBeUndefined();
    expect(decodeCanonicalBase64("aGk=")).toBeDefined();
    expect(decodeCanonicalBase64("aGl=")).toBeUndefined();
    expect(decodeCanonicalBase64("A")).toBeUndefined();
  });

  it("rejects a decoded value that exceeds the byte limit", () => {
    expect(decodeCanonicalBase64("aGVsbG8=", 3)).toBeUndefined();
  });
});

describe("download capabilities", () => {
  const attachmentId = randomUUID();
  const future = Date.now() + 60_000;

  it("verifies a token it issued for the same attachment", () => {
    const token = issueDownloadToken(CAPABILITY_KEY, attachmentId, future);
    expect(verifyDownloadToken(CAPABILITY_KEY, token, Date.now())).toBe(attachmentId);
  });

  it("rejects a token after its expiry", () => {
    const token = issueDownloadToken(CAPABILITY_KEY, attachmentId, future);
    expect(verifyDownloadToken(CAPABILITY_KEY, token, future)).toBeUndefined();
  });

  it("rejects a token with a tampered identifier, expiry or signature", () => {
    const [id, expiry, signature] = issueDownloadToken(CAPABILITY_KEY, attachmentId, future).split(".");
    const otherId = randomUUID();
    expect(verifyDownloadToken(CAPABILITY_KEY, `${otherId}.${expiry}.${signature}`, Date.now())).toBeUndefined();
    expect(verifyDownloadToken(CAPABILITY_KEY, `${id}.${Number(expiry) + 1}.${signature}`, Date.now())).toBeUndefined();
    expect(verifyDownloadToken(CAPABILITY_KEY, `${id}.${expiry}.AAAA`, Date.now())).toBeUndefined();
  });

  it("rejects an oversized expiry that would lose precision", () => {
    const oversizedExpiry = "9999999999999999";
    const payload = `${attachmentId}.${oversizedExpiry}`;
    const signature = createHmac("sha256", CAPABILITY_KEY).update(payload).digest("base64url");
    expect(verifyDownloadToken(CAPABILITY_KEY, `${payload}.${signature}`, Date.now())).toBeUndefined();
  });

  it("rejects a token signed with another key and malformed input", () => {
    const token = issueDownloadToken(randomBytes(32), attachmentId, future);
    expect(verifyDownloadToken(CAPABILITY_KEY, token, Date.now())).toBeUndefined();
    expect(verifyDownloadToken(CAPABILITY_KEY, "not-a-token", Date.now())).toBeUndefined();
    expect(verifyDownloadToken(CAPABILITY_KEY, `${attachmentId}.x.y`, Date.now())).toBeUndefined();
  });

  it("generates a per-process key when none is configured and rejects short configured keys", () => {
    expect(loadCapabilityKey({})).toHaveLength(32);
    expect(() => loadCapabilityKey({ ATTACHMENT_CAPABILITY_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      "at least 32 bytes",
    );
    expect(() => loadCapabilityKey({ ATTACHMENT_CAPABILITY_KEY: "not-valid-base64!" })).toThrow(
      "at least 32 bytes",
    );
    expect(loadCapabilityKey({ ATTACHMENT_CAPABILITY_KEY: Buffer.alloc(32, 7).toString("base64") })).toHaveLength(
      32,
    );
  });
});

describe("filesystem blob store", () => {
  it("refuses keys that are not generated identifiers, so user input cannot traverse paths", async () => {
    const storage = new FileSystemAttachmentStorage("/tmp/shat-attachments-unit");
    await expect(storage.read("../../etc/passwd")).rejects.toThrow("not a generated identifier");
    await expect(storage.write("../escape", Buffer.alloc(1))).rejects.toThrow("not a generated identifier");
  });
});

describe("attachment routes without a database", () => {
  let app: NestFastifyApplication;
  let storage: MemoryStorage;
  let state: FakeState;

  const setup = async (): Promise<void> => {
    storage = new MemoryStorage();
    state = { liveRow: undefined, usedBytes: 0, inserted: [], updates: 0, deletes: 0 };
    const database = { db: fakeDatabase(state), onApplicationShutdown: async () => undefined };
    const auth = {
      getAuthenticatedActor: async (headers: { authorization?: string }) =>
        headers.authorization === "Bearer owner-token"
          ? { id: ownerDeviceId, userId: randomUUID(), sessionId: randomUUID(), tokenHash: Buffer.alloc(0) }
          : undefined,
      getActiveDevice: async (id: string) => ({ id, userId: randomUUID() }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // The fakes implement only the query and method shapes the service uses.
      .overrideProvider(DatabaseService)
      .useValue(database)
      .overrideProvider(AuthService)
      .useValue(auth)
      .overrideProvider(ATTACHMENT_STORAGE)
      .useValue(storage)
      .overrideProvider(ATTACHMENT_CAPABILITY_KEY)
      .useValue(CAPABILITY_KEY)
      .compile();
    app = moduleRef.createNestApplication(new FastifyAdapter(buildApp()));
    await app.init();
  };

  afterEach(async () => {
    await app.close();
  });

  it("rejects uploads without a session with the public envelope and no requestId", async () => {
    await setup();
    const response = await app.inject({ method: "POST", url: "/attachments", payload: uploadBody(randomBytes(8)) });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ statusCode: 401, error: "Unauthorized" });
    expect(response.json()).not.toHaveProperty("requestId");
    expect(storage.blobs.size).toBe(0);
  });

  it("rejects a digest that does not match the ciphertext before any write", async () => {
    await setup();
    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(randomBytes(64), { digestSha256: sha256(Buffer.from("other")).toString("base64") }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ statusCode: 400, message: "The request is invalid" });
    expect(storage.blobs.size).toBe(0);
  });

  it("rejects malformed ciphertext and out-of-range expiry before any write", async () => {
    await setup();
    const plaintext = randomBytes(16);
    const malformed = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(plaintext, { ciphertext: "!!!!" }),
    });
    const expired = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(plaintext, { expiresAt: new Date(Date.now() - 1000).toISOString() }),
    });
    const tooLong = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(plaintext, { expiresAt: new Date(Date.now() + 365 * DAY_MS).toISOString() }),
    });

    expect([malformed.statusCode, expired.statusCode, tooLong.statusCode]).toEqual([400, 400, 400]);
    expect(storage.blobs.size).toBe(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("drops an unknown filename field instead of storing or echoing it", async () => {
    await setup();
    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: { ...uploadBody(randomBytes(16)), fileName: "holiday.jpg" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain("holiday.jpg");
    expect(Object.keys(state.inserted[0] ?? {})).not.toContain("fileName");
  });

  it("answers 413 for a ciphertext over the size bound before it reaches storage", async () => {
    await setup();
    const oversize = randomBytes(ATTACHMENT_LIMITS.maxCiphertextBytes + 1);
    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(oversize),
    });

    expect(response.statusCode).toBe(413);
    expect(storage.blobs.size).toBe(0);
  });

  it("stores verified ciphertext and returns only an opaque id and expiry", async () => {
    await setup();
    const plaintext = Buffer.from("secret-plaintext-marker-" + randomBytes(16).toString("hex"));
    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(plaintext),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ id: string; expiresAt: string }>();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "id"]);
    expect(response.body).not.toContain("secret-plaintext-marker");
    expect(storage.blobs.size).toBe(1);
    const [storedBlob] = [...storage.blobs.values()];
    expect(storedBlob?.equals(plaintext)).toBe(true);
    const [row] = state.inserted;
    expect(row).toMatchObject({ id: body.id, ownerDeviceId, sizeBytes: plaintext.length });
    expect(Object.keys(row ?? {})).not.toContain("fileName");
  });

  it("hashes the ciphertext exactly once on a valid upload", async () => {
    await setup();
    const plaintext = randomBytes(64);
    const payload = uploadBody(plaintext);
    const sha256Spy = vi.mocked(trackedSha256);
    sha256Spy.mockClear();

    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(sha256Spy).toHaveBeenCalledTimes(1);
  });

  it("removes the blob when the owner quota is exhausted, answering 413", async () => {
    await setup();
    state.usedBytes = ATTACHMENT_LIMITS.maxOwnerBytes;
    const response = await app.inject({
      method: "POST",
      url: "/attachments",
      headers: ownerHeaders,
      payload: uploadBody(randomBytes(128)),
    });

    expect(response.statusCode).toBe(413);
    expect(storage.blobs.size).toBe(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("requires a session for capability, download and deletion where it applies", async () => {
    await setup();
    const id = randomUUID();
    const capability = await app.inject({ method: "GET", url: `/attachments/${id}` });
    const invalidId = await app.inject({ method: "GET", url: "/attachments/not-a-uuid", headers: ownerHeaders });
    const deletion = await app.inject({ method: "DELETE", url: `/attachments/${id}` });

    expect(capability.statusCode).toBe(401);
    expect(invalidId.statusCode).toBe(400);
    expect(deletion.statusCode).toBe(401);
  });

  it("issues a download capability for an owned, live attachment and downloads with it", async () => {
    await setup();
    const bytes = randomBytes(300);
    const storageKey = randomUUID();
    state.liveRow = liveRowFor(storageKey, bytes);
    storage.blobs.set(storageKey, bytes);

    const capability = await app.inject({ method: "GET", url: `/attachments/${state.liveRow.id}`, headers: ownerHeaders });
    expect(capability.statusCode).toBe(200);
    const { downloadToken } = capability.json<{ downloadToken: string }>();
    expect(verifyDownloadToken(CAPABILITY_KEY, downloadToken, Date.now())).toBe(state.liveRow.id);

    const download = await app.inject({ method: "GET", url: `/attachments/download?token=${downloadToken}` });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/octet-stream");
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(Buffer.compare(download.rawPayload, bytes)).toBe(0);
  });

  it("answers 401 for missing, forged or expired download tokens", async () => {
    await setup();
    const id = randomUUID();
    const expired = issueDownloadToken(CAPABILITY_KEY, id, Date.now() - 1000);
    const forged = issueDownloadToken(randomBytes(32), id, Date.now() + 60_000);

    const missing = await app.inject({ method: "GET", url: "/attachments/download" });
    const expiredResponse = await app.inject({ method: "GET", url: `/attachments/download?token=${expired}` });
    const forgedResponse = await app.inject({ method: "GET", url: `/attachments/download?token=${forged}` });

    expect(missing.statusCode).toBe(400);
    expect(expiredResponse.statusCode).toBe(401);
    expect(forgedResponse.statusCode).toBe(401);
  });

  it("answers 500 without leaking bytes when stored ciphertext no longer matches its digest", async () => {
    await setup();
    const original = randomBytes(100);
    const tampered = Buffer.from(original);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    const storageKey = randomUUID();
    state.liveRow = liveRowFor(storageKey, original);
    storage.blobs.set(storageKey, tampered);
    const token = issueDownloadToken(CAPABILITY_KEY, state.liveRow.id, Date.now() + 60_000);

    const response = await app.inject({ method: "GET", url: `/attachments/download?token=${token}` });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ statusCode: 500, message: "An unexpected error occurred" });
    expect(JSON.stringify(response.json())).not.toContain(tampered.toString("base64"));
  });

  it("deletes an owned attachment's row and blob, answering 204", async () => {
    await setup();
    const storageKey = randomUUID();
    const bytes = randomBytes(40);
    state.liveRow = liveRowFor(storageKey, bytes);
    storage.blobs.set(storageKey, bytes);

    const response = await app.inject({
      method: "DELETE",
      url: `/attachments/${state.liveRow.id}`,
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(204);
    expect(storage.blobs.size).toBe(0);
    expect(state.updates).toBe(1);
    expect(state.deletes).toBe(1);
  });

  it("purges expired or deleted attachments and their blobs in one batch", async () => {
    await setup();
    const storageKey = randomUUID();
    const bytes = randomBytes(10);
    storage.blobs.set(storageKey, bytes);
    state.liveRow = { ...liveRowFor(storageKey, bytes), expiresAt: new Date(Date.now() - 1) };
    const service = app.get(AttachmentsService);

    const purged = await service.purgeExpired(new Date());

    expect(purged).toBe(1);
    expect(storage.blobs.size).toBe(0);
    expect(state.deletes).toBe(1);
  });
});
