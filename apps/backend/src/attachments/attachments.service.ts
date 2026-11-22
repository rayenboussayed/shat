import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { DatabaseService, attachments } from "../db/db.ts";
import { AuthService } from "../identity/auth.service.ts";
import type { Actor } from "../identity/schemas.ts";
import { digestsEqual, decodeCanonicalBase64, sha256 } from "./encoding.ts";
import {
  ATTACHMENT_CAPABILITY_KEY,
  issueDownloadToken,
  verifyDownloadToken,
} from "./capability.ts";
import { ATTACHMENT_LIMITS } from "./schemas.ts";
import type {
  AttachmentCapability,
  AttachmentCreateBody,
  AttachmentCreated,
  SessionHeaders,
} from "./schemas.ts";
import { ATTACHMENT_STORAGE } from "./storage.ts";
import type { AttachmentStorage } from "./storage.ts";

const PURGE_BATCH_SIZE = 100;

/** Attachment upload, capability, download, deletion and purge of ciphertext blobs. */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_CAPABILITY_KEY) private readonly capabilityKey: Buffer,
  ) {}

  /**
   * Stores a ciphertext blob owned by the session's device after checking its size,
   * digest, expiry and the owner's quota.
   */
  async create(headers: SessionHeaders, body: AttachmentCreateBody): Promise<AttachmentCreated> {
    const actor = await this.requireActor(headers);
    const ciphertext = decodeCanonicalBase64(body.ciphertext);
    if (!ciphertext) {
      throw new BadRequestException("The ciphertext is invalid");
    }
    if (ciphertext.length > ATTACHMENT_LIMITS.maxCiphertextBytes) {
      throw new PayloadTooLargeException("The ciphertext exceeds the size limit");
    }
    this.verifyDigest(ciphertext, body.digestSha256);
    const expiresAt = this.parseExpiry(body.expiresAt, Date.now());

    const id = randomUUID();
    const storageKey = randomUUID();
    await this.storage.write(storageKey, ciphertext);
    try {
      await this.insertWithinQuota({
        id,
        ownerDeviceId: actor.id,
        storageKey,
        sizeBytes: ciphertext.length,
        contentType: body.contentType,
        digest: sha256(ciphertext),
        expiresAt,
      });
    } catch (error) {
      await this.discardBlob(storageKey);
      throw error;
    }
    return { id, expiresAt: expiresAt.toISOString() };
  }

  /** Issues a short-lived download capability for an attachment the caller owns. */
  async createCapability(headers: SessionHeaders, id: string): Promise<AttachmentCapability> {
    const actor = await this.requireActor(headers);
    const row = await this.findOwnedLive(actor, id);
    const nowMs = Date.now();
    if (row.expiresAt.getTime() <= nowMs) {
      throw new NotFoundException("The requested resource was not found");
    }
    const tokenExpiresAt = Math.min(nowMs + ATTACHMENT_LIMITS.downloadTokenTtlMs, row.expiresAt.getTime());
    return {
      id,
      downloadToken: issueDownloadToken(this.capabilityKey, id, tokenExpiresAt),
      downloadTokenExpiresAt: new Date(tokenExpiresAt).toISOString(),
    };
  }

  /** Returns the ciphertext for a valid, unexpired capability, re-checking its digest. */
  async download(token: string): Promise<Buffer> {
    const attachmentId = verifyDownloadToken(this.capabilityKey, token, Date.now());
    if (!attachmentId) {
      throw new UnauthorizedException("The download capability is invalid or expired");
    }
    const row = await this.findLive(attachmentId);
    if (!row) {
      throw new NotFoundException("The requested resource was not found");
    }
    const bytes = await this.storage.read(row.storageKey);
    if (!bytes) {
      throw new NotFoundException("The requested resource was not found");
    }
    if (!digestsEqual(sha256(bytes), row.digestSha256)) {
      throw new InternalServerErrorException("The stored ciphertext could not be verified");
    }
    return bytes;
  }

  /** Deletes an attachment the caller owns: marks it, removes the blob, then the row. */
  async remove(headers: SessionHeaders, id: string): Promise<void> {
    const actor = await this.requireActor(headers);
    const row = await this.findOwnedLive(actor, id);
    await this.database.db
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(attachments.id, id), eq(attachments.ownerDeviceId, actor.id)));
    await this.storage.remove(row.storageKey);
    await this.database.db.delete(attachments).where(eq(attachments.id, id));
  }

  /**
   * Removes a batch of expired or deleted attachments, blob first, so a failed blob
   * removal leaves the row for the next run. Intended to be called by a scheduler.
   *
   * @returns The number of attachments purged in this batch.
   */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const db = this.database.db;
    const due = await db
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(or(isNotNull(attachments.deletedAt), lte(attachments.expiresAt, now)))
      .limit(PURGE_BATCH_SIZE);
    if (due.length === 0) {
      return 0;
    }
    await Promise.all(due.map((row) => this.storage.remove(row.storageKey)));
    await db.delete(attachments).where(inArray(attachments.id, due.map((row) => row.id)));
    return due.length;
  }

  private async requireActor(headers: SessionHeaders): Promise<Actor> {
    const actor = await this.auth.getAuthenticatedActor(headers);
    if (!actor) {
      throw new UnauthorizedException("Authentication is required");
    }
    return actor;
  }

  private verifyDigest(ciphertext: Uint8Array, encodedDigest: string): void {
    const expected = decodeCanonicalBase64(encodedDigest);
    if (!expected || expected.length !== 32) {
      throw new BadRequestException("The digest is invalid");
    }
    if (!digestsEqual(sha256(ciphertext), expected)) {
      throw new BadRequestException("The digest does not match the ciphertext");
    }
  }

  private parseExpiry(value: string, nowMs: number): Date {
    const expiresAt = new Date(value);
    const expiryMs = expiresAt.getTime();
    if (
      Number.isNaN(expiryMs) ||
      expiryMs <= nowMs ||
      expiryMs > nowMs + ATTACHMENT_LIMITS.maxRetentionMs
    ) {
      throw new BadRequestException("The expiry is invalid");
    }
    return expiresAt;
  }

  private async insertWithinQuota(record: {
    id: string;
    ownerDeviceId: string;
    storageKey: string;
    sizeBytes: number;
    contentType: string;
    digest: Buffer;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${record.ownerDeviceId}::text, 0))`,
      );
      const [usage] = await tx
        .select({ total: sql<string>`coalesce(sum(${attachments.sizeBytes}), 0)::text` })
        .from(attachments)
        .where(and(eq(attachments.ownerDeviceId, record.ownerDeviceId), isNull(attachments.deletedAt)));
      if (Number(usage?.total ?? 0) + record.sizeBytes > ATTACHMENT_LIMITS.maxOwnerBytes) {
        throw new PayloadTooLargeException("The attachment quota is exhausted");
      }
      await tx.insert(attachments).values({
        id: record.id,
        ownerDeviceId: record.ownerDeviceId,
        storageKey: record.storageKey,
        sizeBytes: record.sizeBytes,
        contentType: record.contentType,
        digestSha256: record.digest,
        createdAt: new Date(),
        expiresAt: record.expiresAt,
      });
    });
  }

  private async findOwnedLive(actor: Actor, id: string): Promise<typeof attachments.$inferSelect> {
    const [row] = await this.database.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.ownerDeviceId, actor.id),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("The requested resource was not found");
    }
    return row;
  }

  private async findLive(id: string): Promise<typeof attachments.$inferSelect | undefined> {
    const [row] = await this.database.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.id, id),
          isNull(attachments.deletedAt),
          gt(attachments.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  }

  private async discardBlob(storageKey: string): Promise<void> {
    await this.storage.remove(storageKey).catch(() => {
      this.logger.warn("An unreferenced attachment blob could not be removed");
    });
  }
}
