/** Signaling wire protocol version accepted by the server. */
const SIGNALING_PROTOCOL_VERSION = 1;

/** Socket event name that carries client events, server replies and relayed events. */
export const SIGNAL_EVENT = "signal";

/** Largest JSON-encoded client event in bytes (SDP and candidates fit well below this). */
export const MAX_EVENT_BYTES = 16 * 1024;

/** Longest SDP body accepted in an offer, answer or renegotiation. */
const MAX_SDP_CHARS = 12 * 1024;

/** Longest ICE candidate line accepted. */
const MAX_CANDIDATE_CHARS = 1024;

/** Longest lifetime a client may give an event; also the replay-dedupe retention. */
export const MAX_EVENT_LIFETIME_MS = 60 * 1000;

/** Largest accepted clock lead of sentAt over the server clock. */
const MAX_CLOCK_SKEW_MS = 5 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Every event type the signaling protocol knows about. */
const SIGNALING_EVENT_TYPES = [
  "call.invite",
  "call.accept",
  "call.reject",
  "call.cancel",
  "call.end",
  "rtc.offer",
  "rtc.answer",
  "rtc.ice_candidate",
  "call.renegotiate",
  "session.reconnect",
] as const;

/** One of the signaling event types. */
export type SignalingEventType = (typeof SIGNALING_EVENT_TYPES)[number];

/** Payload keys each event type accepts; any other key is rejected. */
const ALLOWED_PAYLOAD_KEYS: Record<SignalingEventType, readonly string[]> = {
  "call.invite": ["mode"],
  "call.accept": [],
  "call.reject": ["reason"],
  "call.cancel": [],
  "call.end": [],
  "rtc.offer": ["sdp"],
  "rtc.answer": ["sdp"],
  "rtc.ice_candidate": ["candidate", "sdpMid", "sdpMLineIndex"],
  "call.renegotiate": ["sdp"],
  "session.reconnect": [],
};

/** Keys a client event may carry at the top level. */
const ALLOWED_ENVELOPE_KEYS = [
  "v",
  "id",
  "type",
  "callId",
  "sentAt",
  "expiresAt",
  "to",
  "payload",
] as const;

/** A client-to-server signaling event, before the server stamps the sender. */
export interface SignalingEnvelope {
  v: typeof SIGNALING_PROTOCOL_VERSION;
  id: string;
  type: SignalingEventType;
  callId: string;
  sentAt: string;
  expiresAt: string;
  to?: string;
  payload: Record<string, unknown>;
}

/** A server-to-recipient event: the client event with the authenticated sender stamped in. */
export interface RelayedEnvelope extends SignalingEnvelope {
  from: string;
  to: string;
}

/** Validation failure codes returned to the sender. */
type ValidationCode = "INVALID_EVENT" | "UNSUPPORTED_VERSION" | "PAYLOAD_TOO_LARGE";

/** Every error code the server returns to a sender. */
export type SignalingErrorCode =
  | ValidationCode
  | "NOT_AUTHENTICATED"
  | "DUPLICATE_EVENT"
  | "CAPACITY_EXCEEDED"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_STATE"
  | "CONFLICT"
  | "RECIPIENT_NOT_ALLOWED"
  | "RATE_LIMITED";

/** Result of validating one raw client event. */
export type ValidationResult =
  | { ok: true; envelope: SignalingEnvelope }
  | { ok: false; code: ValidationCode; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseInstant(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function boundedString(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxChars;
}

function invalid(message: string): ValidationResult {
  return { ok: false, code: "INVALID_EVENT", message };
}

function isEventType(value: unknown): value is SignalingEventType {
  return typeof value === "string" && SIGNALING_EVENT_TYPES.some((type) => type === value);
}

function isEnvelopeKey(key: string): boolean {
  return ALLOWED_ENVELOPE_KEYS.some((allowed) => allowed === key);
}

/** Checks that the payload only holds keys the event type allows, with the right value types. */
function validatePayload(type: SignalingEventType, payload: Record<string, unknown>): string | undefined {
  const allowed = ALLOWED_PAYLOAD_KEYS[type];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    return "The payload has a key this event does not allow";
  }
  switch (type) {
    case "rtc.offer":
    case "rtc.answer":
    case "call.renegotiate":
      return boundedString(payload.sdp, MAX_SDP_CHARS) ? undefined : "The sdp is missing or too long";
    case "rtc.ice_candidate":
      return validateCandidate(payload);
    case "call.invite":
      return payload.mode === undefined || payload.mode === "audio" || payload.mode === "video"
        ? undefined
        : "The invite mode is invalid";
    case "call.reject":
      return payload.reason === undefined || boundedString(payload.reason, 64)
        ? undefined
        : "The reject reason is invalid";
    default:
      return undefined;
  }
}

function validateCandidate(payload: Record<string, unknown>): string | undefined {
  if (!boundedString(payload.candidate, MAX_CANDIDATE_CHARS)) {
    return "The candidate is missing or too long";
  }
  if (payload.sdpMid !== undefined && !boundedString(payload.sdpMid, 64)) {
    return "The sdpMid is invalid";
  }
  const index = payload.sdpMLineIndex;
  if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 255)) {
    return "The sdpMLineIndex is invalid";
  }
  return undefined;
}

/** Checks the timing fields against the server clock and the maximum lifetime. */
function validateTiming(sentAt: number, expiresAt: number, now: number): string | undefined {
  if (expiresAt <= now) {
    return "The event has expired";
  }
  if (expiresAt - now > MAX_EVENT_LIFETIME_MS) {
    return "The event expires too far in the future";
  }
  if (sentAt > now + MAX_CLOCK_SKEW_MS) {
    return "The event is sent in the future";
  }
  if (expiresAt - sentAt > MAX_EVENT_LIFETIME_MS) {
    return "The event lifetime is too long";
  }
  return undefined;
}

/**
 * Validates a raw client event against the protocol schema and the server clock.
 *
 * @param raw - The event as received from the socket, already JSON-parsed.
 * @param now - The server clock in milliseconds.
 * @returns The typed envelope, or the first failure with a public message.
 */
export function validateEnvelope(raw: unknown, now: number): ValidationResult {
  const json = JSON.stringify(raw);
  if (json === undefined) {
    return invalid("The event is missing");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_EVENT_BYTES) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "The event is too large" };
  }
  if (!isPlainObject(raw)) {
    return invalid("The event must be an object");
  }
  if (Object.keys(raw).some((key) => !isEnvelopeKey(key))) {
    return invalid("The event has an unknown field");
  }
  if (raw.v !== SIGNALING_PROTOCOL_VERSION) {
    return { ok: false, code: "UNSUPPORTED_VERSION", message: "The protocol version is not supported" };
  }
  const { id, type, callId, sentAt, expiresAt, to } = raw;
  if (!isEventType(type)) {
    return invalid("The event type is unknown");
  }
  if (!isUuid(id) || !isUuid(callId)) {
    return invalid("The event or call id is invalid");
  }
  const sentMs = parseInstant(sentAt);
  const expiresMs = parseInstant(expiresAt);
  if (sentMs === undefined || expiresMs === undefined) {
    return invalid("The timestamps are invalid");
  }
  const timingError = validateTiming(sentMs, expiresMs, now);
  if (timingError) {
    return invalid(timingError);
  }
  if (to !== undefined && !isUuid(to)) {
    return invalid("The recipient is invalid");
  }
  const payload: unknown = raw.payload === undefined ? {} : raw.payload;
  if (!isPlainObject(payload)) {
    return invalid("The payload must be an object");
  }
  const payloadError = validatePayload(type, payload);
  if (payloadError) {
    return invalid(payloadError);
  }

  return {
    ok: true,
    envelope: {
      v: SIGNALING_PROTOCOL_VERSION,
      id,
      type,
      callId,
      sentAt: new Date(sentMs).toISOString(),
      expiresAt: new Date(expiresMs).toISOString(),
      ...(isUuid(to) ? { to } : {}),
      payload,
    },
  };
}
