/**
 * Call contracts for SHAT mobile.
 *
 * Native call integration (CallKit/PushKit/Core-Telecom) is not implemented
 * here and is unverified in this environment.
 */

/** Call direction. */
export type CallDirection = "incoming" | "outgoing";

/** Call lifecycle states. */
export type CallState =
  | "idle"
  | "ringing"
  | "connecting"
  | "active"
  | "ended"
  | "failed";

/** A call session. */
export interface CallSession {
  readonly id: string;
  readonly direction: CallDirection;
  readonly peerId: string;
  readonly state: CallState;
  readonly startedAt: string | null;
}

/** Platform adapter for native call surfaces. */
export interface CallPlatformAdapter {
  /** Report an incoming call to the platform. */
  reportIncomingCall(session: CallSession): Promise<void>;
  /** Start an outgoing call on the platform. */
  startOutgoingCall(session: CallSession): Promise<void>;
  /** End a call. */
  endCall(sessionId: string): Promise<void>;
  /** Set mute state. */
  setMuted(sessionId: string, muted: boolean): Promise<void>;
  /** Set speaker state. */
  setSpeaker(sessionId: string, speaker: boolean): Promise<void>;
}

/**
 * State machine helper type. Transitions are validated by callers.
 */
export interface CallTransition {
  readonly from: CallState;
  readonly to: CallState;
  readonly at: string;
}
