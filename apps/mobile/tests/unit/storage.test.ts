import { describe, it, expect } from "vitest";
import {
  createMessagesRepository,
  createInMemoryMessagesDatabase,
} from "../../src/storage/messages.ts";

describe("messages repository", () => {
  it("inserts and lists by conversation", async () => {
    const db = createInMemoryMessagesDatabase();
    const repo = createMessagesRepository(db);
    await repo.insert({
      id: "m1",
      conversationId: "c1",
      envelope: "cipher-1",
    });
    await repo.insert({
      id: "m2",
      conversationId: "c2",
      envelope: "cipher-2",
    });
    const list = await repo.listByConversation("c1");
    expect(list).toHaveLength(1);
    expect(list[0]?.envelope).toBe("cipher-1");
    expect(list[0]?.conversationId).toBe("c1");
  });

  it("bounds list queries", async () => {
    const db = createInMemoryMessagesDatabase();
    const repo = createMessagesRepository(db);
    for (let i = 0; i < 10; i += 1) {
      await repo.insert({
        id: `m${i}`,
        conversationId: "c1",
        envelope: `cipher-${i}`,
      });
    }
    const list = await repo.listByConversation("c1", 3);
    expect(list).toHaveLength(3);
  });

  it("deletes by conversation", async () => {
    const db = createInMemoryMessagesDatabase();
    const repo = createMessagesRepository(db);
    await repo.insert({ id: "m1", conversationId: "c1", envelope: "a" });
    await repo.insert({ id: "m2", conversationId: "c1", envelope: "b" });
    await repo.insert({ id: "m3", conversationId: "c2", envelope: "c" });
    const removed = await repo.deleteByConversation("c1");
    expect(removed).toBe(2);
    expect(await repo.listByConversation("c1")).toHaveLength(0);
    expect(await repo.listByConversation("c2")).toHaveLength(1);
  });

  it("stores only ciphertext envelopes (no plaintext field)", async () => {
    const db = createInMemoryMessagesDatabase();
    const repo = createMessagesRepository(db);
    await repo.insert({ id: "m1", conversationId: "c1", envelope: "cipher" });
    const list = await repo.listByConversation("c1");
    expect(Object.prototype.hasOwnProperty.call(list[0], "content")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(list[0], "plaintext")).toBe(false);
  });
});
