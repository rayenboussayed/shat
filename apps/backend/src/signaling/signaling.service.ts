import { Injectable, Logger } from "@nestjs/common";
import { AuthService } from "../identity/auth.service.ts";
import type { Actor } from "../identity/schemas.ts";
import { ConnectionRegistry } from "./connections.ts";
import { CallRegistry } from "./call-state.ts";
import type { CallEffect } from "./call-state.ts";
import { ReplayGuard } from "./guards.ts";
import { SIGNAL_EVENT, validateEnvelope } from "./schemas.ts";
import type { RelayedEnvelope, SignalingEnvelope, SignalingErrorCode } from "./schemas.ts";

/** Reply sent back to the sender of one event. */
export type SignalingReply =
  | { type: "signal.ready" }
  | { type: "signal.delivered"; eventId: string; callId: string }
  | { type: "signal.offline"; eventId: string; callId: string }
  | { type: "signal.error"; code: SignalingErrorCode; message: string; eventId?: string };

/** Reply plus what the log line needs; the payload itself is never logged. */
interface Handled {
  reply: SignalingReply;
  eventType?: string;
  callId?: string;
}

/** Outcome of one authorization step, before logging context is added. */
type Step = Pick<Handled, "reply">;

function errorReply(code: SignalingErrorCode, message: string, eventId?: string): SignalingReply {
  return eventId === undefined
    ? { type: "signal.error", code, message }
    : { type: "signal.error", code, message, eventId };
}

function offlineReply(eventId: string, callId: string): SignalingReply {
  return { type: "signal.offline", eventId, callId };
}

/**
 * Validates, authorizes and relays signaling events between authenticated devices.
 *
 * The sender is always the authenticated device. The recipient of every event
 * after call.invite comes from the call state, never from the client. Media is
 * never stored: relayed payloads are not kept or logged.
 */
@Injectable()
export class SignalingService {
  private readonly logger = new Logger("Signaling");

  constructor(
    private readonly auth: AuthService,
    private readonly connections: ConnectionRegistry,
    private readonly calls: CallRegistry,
    private readonly replay: ReplayGuard,
  ) {}

  /**
   * Handles one raw client event from an authenticated sender.
   *
   * @param actor - The authenticated device that sent the event.
   * @param raw - The event as received, already JSON-parsed.
   * @param now - The server clock in milliseconds.
   * @returns The reply for the sender.
   */
  async handle(actor: Actor, raw: unknown, now: number = Date.now()): Promise<SignalingReply> {
    const outcome = await this.process(actor, raw, now);
    const result = outcome.reply.type === "signal.error" ? outcome.reply.code : outcome.reply.type;
    this.logger.log(`event=${outcome.eventType ?? "unknown"} call=${outcome.callId ?? "-"} outcome=${result}`);
    return outcome.reply;
  }

  private async process(actor: Actor, raw: unknown, now: number): Promise<Handled> {
    const checked = validateEnvelope(raw, now);
    if (!checked.ok) {
      return { reply: errorReply(checked.code, checked.message) };
    }
    const event = checked.envelope;
    const base = { eventType: event.type, callId: event.callId };
    if (this.replay.has(event.callId, event.id, now)) {
      return { ...base, reply: errorReply("DUPLICATE_EVENT", "The event was already received", event.id) };
    }
    const sender = await this.auth.getActiveDevice(actor.id);
    if (!sender) {
      return { ...base, reply: errorReply("NOT_AUTHENTICATED", "Authentication is required", event.id) };
    }
    if (event.type === "call.invite") {
      return { ...base, ...(await this.invite(actor, event, now)) };
    }
    return { ...base, ...(await this.relay(actor, event, now)) };
  }

  private async invite(actor: Actor, event: SignalingEnvelope, now: number): Promise<Step> {
    const eventId = event.id;
    if (event.to === undefined) {
      return { reply: errorReply("INVALID_EVENT", "The invite has no recipient", eventId) };
    }
    if (event.to === actor.id) {
      return { reply: errorReply("INVALID_EVENT", "A device cannot invite itself", eventId) };
    }
    if (this.calls.get(event.callId, now)) {
      return { reply: errorReply("CONFLICT", "The call already exists", eventId) };
    }
    const recipient = await this.auth.getActiveDevice(event.to);
    if (!recipient || recipient.userId !== actor.userId) {
      return { reply: errorReply("RECIPIENT_NOT_ALLOWED", "The recipient cannot be invited", eventId) };
    }
    const admitted = this.admit(event, now);
    if (admitted) {
      return admitted;
    }
    if (!this.connections.isOnline(recipient.id)) {
      return { reply: offlineReply(eventId, event.callId) };
    }
    if (!this.calls.start(event.callId, actor.id, recipient.id, now)) {
      return { reply: errorReply("CAPACITY_EXCEEDED", "The server is busy", eventId) };
    }
    return this.deliver(event, actor.id, recipient.id, "keep", now);
  }

  private async relay(actor: Actor, event: SignalingEnvelope, now: number): Promise<Step> {
    const eventId = event.id;
    if (event.type === "call.invite") {
      return { reply: errorReply("INVALID_EVENT", "Unexpected invite", eventId) };
    }
    const decision = this.calls.decide(event.callId, event.type, actor.id, now);
    if (!decision.ok) {
      return { reply: errorReply(decision.refusal, "The event is not allowed in this call state", eventId) };
    }
    const recipient = await this.auth.getActiveDevice(decision.recipientDeviceId);
    if (!recipient) {
      return { reply: errorReply("RECIPIENT_NOT_ALLOWED", "The recipient cannot be reached", eventId) };
    }
    const admitted = this.admit(event, now);
    if (admitted) {
      return admitted;
    }
    if (!this.connections.isOnline(recipient.id)) {
      if (decision.effect === "end") {
        this.calls.apply(event.callId, "end", now);
      }
      return { reply: offlineReply(eventId, event.callId) };
    }
    return this.deliver(event, actor.id, recipient.id, decision.effect, now);
  }

  /**
   * Records the event id once the event is authorized, so refused events cannot use up the replay guard.
   *
   * @returns The refusal reply when the id was already recorded or the guard is full, otherwise undefined.
   */
  private admit(event: SignalingEnvelope, now: number): Step | undefined {
    const recorded = this.replay.record(event.callId, event.id, now);
    if (recorded === "duplicate") {
      return { reply: errorReply("DUPLICATE_EVENT", "The event was already received", event.id) };
    }
    if (recorded === "full") {
      return { reply: errorReply("CAPACITY_EXCEEDED", "The server is busy", event.id) };
    }
    return undefined;
  }

  private deliver(
    event: SignalingEnvelope,
    senderId: string,
    recipientId: string,
    effect: CallEffect,
    now: number,
  ): Step {
    const relayed: RelayedEnvelope = { ...event, from: senderId, to: recipientId };
    const sent = this.connections.sendTo(recipientId, SIGNAL_EVENT, relayed);
    if (sent === 0) {
      if (effect === "end" || event.type === "call.invite") {
        this.calls.apply(event.callId, "end", now);
      }
      return { reply: offlineReply(event.id, event.callId) };
    }
    this.calls.apply(event.callId, effect, now);
    return { reply: { type: "signal.delivered", eventId: event.id, callId: event.callId } };
  }
}
