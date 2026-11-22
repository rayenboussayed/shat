import { Injectable } from "@nestjs/common";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { DatabaseService } from "../db/db.ts";
import {
  devices,
  sessions,
} from "../db/db.ts";
import { decodeCanonicalBase64, sha256 } from "../encoding.ts";
import type { SessionHeaders, Actor } from "./schemas.ts";

/** Handles session token extraction, hashing and constant-time comparison. */
@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService) {}


  /** Generates a fresh session token. */
  newSessionToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /** Hashes a session or enrollment secret with SHA-256. */
  hashToken(token: string): Buffer {
    return sha256(Buffer.from(token, "utf8"));
  }

  /** Extracts a session token from headers, rejecting mixed or oversized inputs. */
  getSessionToken(headers: SessionHeaders): string | undefined {
    const sessionHeader = headers["x-session-token"];
    const authorization = headers.authorization;
    if (sessionHeader !== undefined && authorization !== undefined) {
      return undefined;
    }
    if (sessionHeader !== undefined) {
      return sessionHeader.length > 0 && sessionHeader.length <= 1024 ? sessionHeader : undefined;
    }
    if (authorization === undefined) {
      return undefined;
    }

    const match = /^Bearer ([^\s]{1,1024})$/i.exec(authorization);
    return match?.[1];
  }

  /** Looks up an authenticated actor by session token. */
  async getAuthenticatedActor(headers: SessionHeaders): Promise<Actor | undefined> {
    const token = this.getSessionToken(headers);
    if (!token) {
      return undefined;
    }

    const tokenHash = this.hashToken(token);
    const db = this.database.db;
    const [session] = await db
      .select({
        sessionId: sessions.id,
        tokenHash: sessions.tokenHash,
        id: devices.id,
        userId: devices.userId,
      })
      .from(sessions)
      .innerJoin(devices, eq(sessions.deviceId, devices.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          isNull(devices.revokedAt),
        ),
      )
      .limit(1);
    if (!session) {
      return undefined;
    }

    const storedHash = Buffer.from(session.tokenHash);
    if (storedHash.length !== tokenHash.length || !timingSafeEqual(storedHash, tokenHash)) {
      return undefined;
    }

    return { id: session.id, userId: session.userId, sessionId: session.sessionId, tokenHash };
  }

  /** Compares an enrollment secret in constant time. */
  matchesSecret(candidate: string, expected: string): boolean {
    const candidateHash = this.hashToken(candidate);
    const expectedHash = this.hashToken(expected);
    return timingSafeEqual(candidateHash, expectedHash);
  }

  /** Compares two UTF-8 strings in constant time with length checks. */
  matchesUtf8(candidate: string, expected: string): boolean {
    const candidateBytes = Buffer.from(candidate, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    return (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  }

  /** Decodes canonical base64 with an exact byte length. */
  decodeBase64(value: string, expectedByteLength: number): Buffer | undefined {
    const decoded = decodeCanonicalBase64(value, expectedByteLength);
    return decoded?.length === expectedByteLength ? decoded : undefined;
  }

  /** Looks up an active (non-revoked) device. */
  async getActiveDevice(deviceId: string): Promise<{ id: string; userId: string } | undefined> {
    const db = this.database.db;
    const [device] = await db
      .select({ id: devices.id, userId: devices.userId })
      .from(devices)
      .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
      .limit(1);
    return device;
  }
}