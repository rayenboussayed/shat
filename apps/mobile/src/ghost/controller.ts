/**
 * Ghost Mode controller for the mobile app.
 */

import { isGhostModeEnabled } from "shat-api-types";

/** Upper bound on buffered messages per conversation; oldest are dropped first. */
export const MAX_MESSAGES_PER_CONVERSATION = 1000;

/** A message held in volatile memory by Ghost Mode. */
export interface GhostMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly content: string;
  readonly createdAt: string;
}

/** Abstraction over native lifecycle events used to clear Ghost Mode buffers. */
export interface AppLifecycleSource {
  onBackground(callback: () => void): () => void;
}

/** Optional persistent store used when Ghost Mode is disabled. */
export interface GhostPersistentStore {
  insert(message: {
    readonly id: string;
    readonly conversationId: string;
    readonly envelope: string;
  }): Promise<void>;
}

/** Controller for the mobile Ghost Mode lifecycle and volatile buffer. */
export class GhostModeController {
  private readonly defaultEnabled: boolean;
  private enabled: boolean;
  private readonly buffer = new Map<string, GhostMessage[]>();
  private persistentStore: GhostPersistentStore | null = null;
  private unsubscribeBackground: (() => void) | null = null;

  constructor(options?: {
    readonly defaultEnabled?: boolean;
    readonly lifecycle?: AppLifecycleSource;
  }) {
    this.defaultEnabled = isGhostModeEnabled(options?.defaultEnabled);
    this.enabled = this.defaultEnabled;
    if (options?.lifecycle !== undefined) {
      this.unsubscribeBackground = options.lifecycle.onBackground(() => {
        this.handleAppBackground();
      });
    }
  }

  get isDefaultEnabled(): boolean {
    return this.defaultEnabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
    this.buffer.clear();
  }

  disable(): void {
    this.enabled = false;
    this.buffer.clear();
  }

  /**
   * Buffers message content in volatile memory only while Ghost Mode is
   * enabled. When disabled, the content is not retained. The buffer is capped
   * at {@link MAX_MESSAGES_PER_CONVERSATION} entries per conversation; once
   * full, the oldest message is dropped so a long session cannot grow without
   * bound.
   */
  store(conversationId: string, content: string, id?: string): GhostMessage {
    const message: GhostMessage = {
      id: id ?? createId(),
      conversationId,
      content,
      createdAt: new Date().toISOString(),
    };
    if (this.enabled) {
      const existing = this.buffer.get(conversationId) ?? [];
      const appended = [...existing, message];
      const bounded =
        appended.length > MAX_MESSAGES_PER_CONVERSATION
          ? appended.slice(appended.length - MAX_MESSAGES_PER_CONVERSATION)
          : appended;
      this.buffer.set(conversationId, bounded);
    }
    return message;
  }

  /**
   * Returns a shallow copy of the buffered messages for a conversation.
   */
  read(conversationId: string): readonly GhostMessage[] {
    return [...(this.buffer.get(conversationId) ?? [])];
  }

  closeConversation(conversationId: string): void {
    this.buffer.delete(conversationId);
  }

  handleAppBackground(): void {
    this.buffer.clear();
  }

  dispose(): void {
    this.unsubscribeBackground?.();
    this.unsubscribeBackground = null;
    this.buffer.clear();
  }

  enablePersistentMode(store: GhostPersistentStore): void {
    this.persistentStore = store;
    this.enabled = false;
    this.buffer.clear();
  }

  disablePersistentMode(): void {
    this.persistentStore = null;
    this.enabled = this.defaultEnabled;
    this.buffer.clear();
  }

  get isPersistent(): boolean {
    return this.persistentStore !== null;
  }

  async persistEnvelope(
    conversationId: string,
    envelope: string,
    id?: string,
  ): Promise<void> {
    if (this.persistentStore === null) {
      throw new Error("persistent mode is not enabled");
    }
    await this.persistentStore.insert({
      id: id ?? createId(),
      conversationId,
      envelope,
    });
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Non-crypto fallback only: no Math.random. This id is not suitable for
  // security-sensitive use; prefer a CryptoFacade implementation when available.
  counter += 1;
  return `msg-${Date.now()}-${counter.toString(36)}`;
}

let counter = 0;
