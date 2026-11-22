import { Injectable } from "@nestjs/common";
import type { SignalingErrorCode, SignalingEventType } from "./schemas.ts";

/** Most calls one server instance tracks at once. */
const MAX_TRACKED_CALLS = 10_000;

/** How long an unanswered call stays ringing before it is dropped. */
const RINGING_TTL_MS = 60 * 1000;

/** How long an answered call stays tracked after its last event. */
const ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;

/** Phase of a tracked call. Ended calls are removed, never stored. */
type CallPhase = "ringing" | "active";

/** Devices that took part in one call. */
export interface CallRecord {
  callId: string;
  callerDeviceId: string;
  calleeDeviceId: string;
  phase: CallPhase;
  updatedAt: number;
}

/** Which participant may send an event type. */
type Role = "caller" | "callee" | "either";

/** What an accepted event does to the call. */
export type CallEffect = "keep" | "end" | "active" | "refresh";

/** Authorization rule for one relayed event type. */
interface EventRule {
  phases: readonly CallPhase[];
  sender: Role;
  effect: CallEffect;
}

/** Authorization rules for every event type that is relayed to the other participant. */
const EVENT_RULES: Record<Exclude<SignalingEventType, "call.invite">, EventRule> = {
  "call.accept": { phases: ["ringing"], sender: "callee", effect: "active" },
  "call.reject": { phases: ["ringing"], sender: "callee", effect: "end" },
  "call.cancel": { phases: ["ringing"], sender: "caller", effect: "end" },
  "call.end": { phases: ["active"], sender: "either", effect: "end" },
  "rtc.offer": { phases: ["active"], sender: "caller", effect: "keep" },
  "rtc.answer": { phases: ["active"], sender: "callee", effect: "keep" },
  "rtc.ice_candidate": { phases: ["active"], sender: "either", effect: "keep" },
  "call.renegotiate": { phases: ["active"], sender: "either", effect: "keep" },
  "session.reconnect": { phases: ["ringing", "active"], sender: "either", effect: "refresh" },
};

/** Reasons an event is refused by the call state machine, as the codes sent to the sender. */
type CallRefusal = Extract<SignalingErrorCode, "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE">;

/** Outcome of checking an event against the call state. */
export type CallDecision =
  | { ok: true; recipientDeviceId: string; effect: CallEffect }
  | { ok: false; refusal: CallRefusal };

function roleOf(call: CallRecord, deviceId: string): Role | undefined {
  if (deviceId === call.callerDeviceId) {
    return "caller";
  }
  return deviceId === call.calleeDeviceId ? "callee" : undefined;
}

function roleAllowed(rule: Role, actual: Role): boolean {
  return rule === "either" || rule === actual;
}

/**
 * Tracks the state of signaling calls in memory for this process.
 *
 * Calls are not shared across instances, so a call set up on one instance cannot
 * be continued on another. Routing across instances is out of scope here.
 */
@Injectable()
export class CallRegistry {
  private readonly calls = new Map<string, CallRecord>();

  /**
   * Looks up a live call, dropping it first if its lifetime has passed.
   *
   * @param callId - The call id from the event.
   * @param now - The server clock in milliseconds.
   * @returns The live call, or undefined when unknown or expired.
   */
  get(callId: string, now: number): CallRecord | undefined {
    const call = this.calls.get(callId);
    if (!call) {
      return undefined;
    }
    if (now - call.updatedAt > lifetimeOf(call.phase)) {
      this.calls.delete(callId);
      return undefined;
    }
    return call;
  }

  /**
   * Starts a ringing call from an accepted invite.
   *
   * @param callId - The new call id.
   * @param callerDeviceId - The device that invites.
   * @param calleeDeviceId - The device that is invited.
   * @param now - The server clock in milliseconds.
   * @returns False when the call id is taken or this instance is at capacity.
   */
  start(callId: string, callerDeviceId: string, calleeDeviceId: string, now: number): boolean {
    this.prune(now);
    if (this.calls.has(callId) || this.calls.size >= MAX_TRACKED_CALLS) {
      return false;
    }
    this.calls.set(callId, { callId, callerDeviceId, calleeDeviceId, phase: "ringing", updatedAt: now });
    return true;
  }

  /**
   * Checks a relayed event against the call state and returns the other participant.
   *
   * @param callId - The call id from the event.
   * @param type - The event type.
   * @param senderDeviceId - The authenticated sender.
   * @param now - The server clock in milliseconds.
   * @returns The recipient and effect, or the reason the event is refused.
   */
  decide(
    callId: string,
    type: Exclude<SignalingEventType, "call.invite">,
    senderDeviceId: string,
    now: number,
  ): CallDecision {
    const call = this.get(callId, now);
    if (!call) {
      return { ok: false, refusal: "NOT_FOUND" };
    }
    const role = roleOf(call, senderDeviceId);
    if (!role) {
      return { ok: false, refusal: "FORBIDDEN" };
    }
    const rule = EVENT_RULES[type];
    if (!rule.phases.includes(call.phase)) {
      return { ok: false, refusal: "INVALID_STATE" };
    }
    if (!roleAllowed(rule.sender, role)) {
      return { ok: false, refusal: "FORBIDDEN" };
    }
    const recipientDeviceId = role === "caller" ? call.calleeDeviceId : call.callerDeviceId;
    return { ok: true, recipientDeviceId, effect: rule.effect };
  }

  /**
   * Applies a call effect after the event has been delivered.
   *
   * @param callId - The call id.
   * @param effect - The effect returned by decide().
   * @param now - The server clock in milliseconds.
   */
  apply(callId: string, effect: CallEffect, now: number): void {
    const call = this.calls.get(callId);
    if (!call) {
      return;
    }
    if (effect === "end") {
      this.calls.delete(callId);
      return;
    }
    if (effect === "refresh" && call.phase === "ringing") {
      return;
    }
    call.updatedAt = now;
    if (effect === "active") {
      call.phase = "active";
    }
  }

  /** Drops calls whose lifetime has passed. */
  private prune(now: number): void {
    for (const call of this.calls.values()) {
      if (now - call.updatedAt > lifetimeOf(call.phase)) {
        this.calls.delete(call.callId);
      }
    }
  }

  /** Number of live calls tracked by this instance. */
  get size(): number {
    return this.calls.size;
  }
}

function lifetimeOf(phase: CallPhase): number {
  return phase === "ringing" ? RINGING_TTL_MS : ACTIVE_TTL_MS;
}
