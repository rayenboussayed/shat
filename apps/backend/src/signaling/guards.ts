import { Injectable } from "@nestjs/common";
import { MAX_EVENT_LIFETIME_MS } from "./schemas.ts";

/** Events one connection may send per window. */
export const RATE_LIMIT_EVENTS = 30;

/** Length of the rate-limit window in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Most event ids remembered by one server instance before new events are refused. */
export const REPLAY_GUARD_CAPACITY = 10_000;

/** Sliding-window event limiter for one connection. */
export class ConnectionRateLimiter {
  private readonly timestamps: number[] = [];

  /**
   * Records an inbound event if the connection is under its limit.
   *
   * @param now - The server clock in milliseconds.
   * @returns True when the event is admitted.
   */
  take(now: number): boolean {
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) <= windowStart) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= RATE_LIMIT_EVENTS) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}

/**
 * Remembers recent event ids per call so a replayed or duplicated event is refused.
 *
 * Entries live for MAX_EVENT_LIFETIME_MS from when they were recorded. Validation
 * caps every event's expiry at that lifetime, so an entry outlives any event it
 * could still be replayed as. State is in memory and per process only.
 */
@Injectable()
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  /**
   * Records an event id for a call, or reports that it was already seen.
   *
   * @param callId - The call or session the event belongs to.
   * @param eventId - The client-chosen unique event id.
   * @param now - The server clock in milliseconds.
   * @returns "accepted", "duplicate", or "full" when the guard is at capacity.
   */
  record(callId: string, eventId: string, now: number): "accepted" | "duplicate" | "full" {
    this.prune(now);
    const key = `${callId}:${eventId}`;
    if (this.seen.has(key)) {
      return "duplicate";
    }
    if (this.seen.size >= REPLAY_GUARD_CAPACITY) {
      return "full";
    }
    this.seen.set(key, now + MAX_EVENT_LIFETIME_MS);
    return "accepted";
  }

  /**
   * Reports whether an event id is still remembered for a call, without recording it.
   *
   * @param callId - The call or session the event belongs to.
   * @param eventId - The client-chosen unique event id.
   * @param now - The server clock in milliseconds.
   * @returns True when the event id is remembered and not yet expired.
   */
  has(callId: string, eventId: string, now: number): boolean {
    const expiresAt = this.seen.get(`${callId}:${eventId}`);
    return expiresAt !== undefined && expiresAt > now;
  }

  /** Drops entries whose retention ended. Insertion order is time order, so pruning stops at the first live entry. */
  private prune(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt > now) {
        return;
      }
      this.seen.delete(key);
    }
  }

  /** Number of event ids currently remembered. */
  get size(): number {
    return this.seen.size;
  }
}
