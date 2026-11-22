import { Injectable } from "@nestjs/common";
import { MAX_EVENT_LIFETIME_MS } from "./schemas.ts";

/** Events one connection may send per window. */
export const RATE_LIMIT_EVENTS = 30;

/** Length of the rate-limit window in milliseconds. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Most event ids remembered by one server instance before new events are refused. */
export const REPLAY_GUARD_CAPACITY = 10_000;

/** Most failed authentication handshakes accepted from one source before new ones are refused. */
export const MAX_FAILED_AUTH_ATTEMPTS = 50;

/** Most pre-auth connection attempts accepted from one source per window. */
export const MAX_PRE_AUTH_CONNECTIONS = 60;

/** Window over which failed authentication handshakes and connections are counted. */
const FAILED_AUTH_WINDOW_MS = 10 * 1000;

/** Most source keys tracked at once before the oldest is evicted. */
const MAX_TRACKED_SOURCES = 10_000;

/**
 * Sliding-window timestamp counter, bounded to `max` events per `windowMs`.
 * Subclasses provide the budget and window; state is in memory and per process.
 */
export class SlidingWindow {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True when this window already holds its full quota. */
  isFull(now: number): boolean {
    this.prune(now);
    return this.timestamps.length >= this.max;
  }

  /** Records one event in this window. */
  record(now: number): void {
    this.timestamps.push(now);
  }

  /** Admits an event when the window has room, recording it on success. */
  take(now: number): boolean {
    if (this.isFull(now)) {
      return false;
    }
    this.record(now);
    return true;
  }

  /** True when no live events remain, so a keyed registry can drop the source. */
  isEmpty(now: number): boolean {
    this.prune(now);
    return this.timestamps.length === 0;
  }

  /** Drops events older than the window. */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) <= cutoff) {
      this.timestamps.shift();
    }
  }
}

/** Bounded sliding-window counter for failed signaling handshakes from one source. */
export class FailedAuthLimiter extends SlidingWindow {
  constructor() {
    super(MAX_FAILED_AUTH_ATTEMPTS, FAILED_AUTH_WINDOW_MS);
  }
}

/** Cheap per-source connection cap applied before any database lookup. */
export class PreAuthLimiter extends SlidingWindow {
  constructor() {
    super(MAX_PRE_AUTH_CONNECTIONS, FAILED_AUTH_WINDOW_MS);
  }
}

/** Sliding-window event limiter for one connection. */
export class ConnectionRateLimiter extends SlidingWindow {
  constructor() {
    super(RATE_LIMIT_EVENTS, RATE_LIMIT_WINDOW_MS);
  }
}

/**
 * Registry of per-source sliding windows. Each source IP gets an independent
 * budget, so one flood cannot exhaust another client's allowance. The map is
 * bounded by evicting the oldest entry and dropping windows whose events aged out.
 */
export class KeyedRateLimiter {
  private readonly bySource = new Map<string, SlidingWindow>();

  constructor(
    private readonly makeWindow: () => SlidingWindow,
    private readonly maxSources = MAX_TRACKED_SOURCES,
  ) {}

  /** True when this source's window is full. */
  isFull(source: string, now: number): boolean {
    return this.windowFor(source, now).isFull(now);
  }

  /** Records one event for this source. */
  record(source: string, now: number): void {
    this.windowFor(source, now).record(now);
  }

  /** Admits one event for this source when its window has room. */
  take(source: string, now: number): boolean {
    return this.windowFor(source, now).take(now);
  }

  /** Number of source keys currently tracked (for observability and tests). */
  get size(): number {
    return this.bySource.size;
  }

  /** Drops sources whose window is empty at `now`. */
  prune(now: number): void {
    for (const [source, window] of this.bySource) {
      if (window.isEmpty(now)) {
        this.bySource.delete(source);
      }
    }
  }

  private windowFor(source: string, now: number): SlidingWindow {
    const existing = this.bySource.get(source);
    if (existing) {
      return existing;
    }
    this.prune(now);
    if (this.bySource.size >= this.maxSources) {
      const oldest = this.bySource.keys().next().value;
      if (oldest !== undefined) {
        this.bySource.delete(oldest);
      }
    }
    const window = this.makeWindow();
    this.bySource.set(source, window);
    return window;
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
