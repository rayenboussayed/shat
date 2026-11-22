import { Logger } from "@nestjs/common";
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from "@nestjs/websockets";
import type { OnGatewayConnection, OnGatewayDisconnect } from "@nestjs/websockets";
import type { IncomingHttpHeaders } from "node:http";
import { AuthService } from "../identity/auth.service.ts";
import type { Actor, SessionHeaders } from "../identity/schemas.ts";
import { ConnectionRegistry } from "./connections.ts";
import type { SignalingClient } from "./connections.ts";
import { ConnectionRateLimiter, FailedAuthLimiter, KeyedRateLimiter, PreAuthLimiter } from "./guards.ts";
import { MAX_EVENT_BYTES, SIGNAL_EVENT } from "./schemas.ts";
import type { SignalingErrorCode } from "./schemas.ts";
import { SignalingService } from "./signaling.service.ts";
import type { SignalingReply } from "./signaling.service.ts";

/** Handshake fields the session token is read from. */
export interface SignalingHandshake {
  headers: IncomingHttpHeaders;
  auth: Record<string, unknown>;
  /** Socket remote address, used to isolate per-source rate limits. */
  address?: string;
}

/** A connected socket with the handshake it was opened with. */
export interface SignalingSocket extends SignalingClient {
  readonly handshake: SignalingHandshake;
}

/** Transport allowance on top of the event size for the envelope wrapper. */
const FRAME_OVERHEAD_BYTES = 512;

/**
 * Takes the session token from the Authorization header (native clients) or from
 * the `token` handshake auth field (browsers, which cannot set WebSocket headers).
 *
 * @param handshake - The socket handshake.
 * @returns Headers in the shape AuthService expects.
 */
export function handshakeHeaders(handshake: SignalingHandshake): SessionHeaders {
  const authorization = handshake.headers.authorization;
  if (authorization !== undefined) {
    return { authorization };
  }
  const token = handshake.auth.token;
  return typeof token === "string" && token.length > 0 ? { authorization: `Bearer ${token}` } : {};
}

/** Extracts the source key used to isolate rate limits; sockets without an address share one bucket. */
function sourceAddress(client: SignalingSocket): string {
  const address = client.handshake.address;
  return typeof address === "string" && address.length > 0 ? address : "unknown";
}

/**
 * Signaling endpoint for call setup and ICE negotiation at /signaling.
 *
 * Clients must authenticate during the handshake. An unauthenticated socket gets
 * one signal.error frame and is disconnected, as does a socket beyond the device's
 * open-socket cap. An accepted client gets signal.ready. Client events, server
 * replies and relayed events all use the "signal" event.
 */
@WebSocketGateway({ path: "/signaling", maxHttpBufferSize: MAX_EVENT_BYTES + FRAME_OVERHEAD_BYTES })
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger("Signaling");
  private readonly sessions = new Map<SignalingClient, Actor>();
  private readonly limiters = new Map<string, ConnectionRateLimiter>();
  private readonly failedAuth = new KeyedRateLimiter(() => new FailedAuthLimiter());
  private readonly preAuth = new KeyedRateLimiter(() => new PreAuthLimiter());

  constructor(
    private readonly auth: AuthService,
    private readonly connections: ConnectionRegistry,
    private readonly signaling: SignalingService,
  ) {}

  /**
   * Authenticates a new socket and registers it for its device.
   *
   * @param client - The new socket.
   */
  async handleConnection(client: SignalingSocket): Promise<void> {
    const now = Date.now();
    const source = sourceAddress(client);
    if (this.failedAuth.isFull(source, now)) {
      this.logger.log("event=connect outcome=auth-flood");
      this.refuse(client, "RATE_LIMITED", "Too many authentication attempts");
      return;
    }
    if (!this.preAuth.take(source, now)) {
      this.logger.log("event=connect outcome=connect-flood");
      this.refuse(client, "RATE_LIMITED", "Too many connection attempts");
      return;
    }
    const actor = await this.auth.getAuthenticatedActor(handshakeHeaders(client.handshake));
    if (!client.connected) {
      return;
    }
    if (!actor) {
      this.failedAuth.record(source, Date.now());
      this.logger.log("event=connect outcome=unauthenticated");
      this.refuse(client, "NOT_AUTHENTICATED", "Authentication is required");
      return;
    }
    if (!this.connections.add(actor.id, client)) {
      this.logger.log("event=connect outcome=too-many-sockets");
      this.refuse(client, "CAPACITY_EXCEEDED", "The device has too many open connections");
      return;
    }
    this.sessions.set(client, actor);
    client.emit(SIGNAL_EVENT, { type: "signal.ready" } satisfies SignalingReply);
  }

  /**
   * Forgets a closed socket.
   *
   * @param client - The closed socket.
   */
  handleDisconnect(client: SignalingClient): void {
    const actor = this.sessions.get(client);
    if (!actor) {
      return;
    }
    this.sessions.delete(client);
    this.connections.remove(actor.id, client);
    if (this.connections.socketCount(actor.id) === 0) {
      this.limiters.delete(actor.id);
    }
  }

  /**
   * Handles one signaling event from an authenticated socket.
   *
   * @param client - The sending socket.
   * @param data - The event body.
   */
  @SubscribeMessage(SIGNAL_EVENT)
  async onSignal(@ConnectedSocket() client: SignalingSocket, @MessageBody() data: unknown): Promise<void> {
    const reply = await this.dispatch(client, data);
    client.emit(SIGNAL_EVENT, reply);
  }

  private async dispatch(client: SignalingClient, data: unknown): Promise<SignalingReply> {
    const actor = this.sessions.get(client);
    if (!actor) {
      return { type: "signal.error", code: "NOT_AUTHENTICATED", message: "Authentication is required" };
    }
    if (!this.limiterFor(actor.id).take(Date.now())) {
      return { type: "signal.error", code: "RATE_LIMITED", message: "The event rate limit was exceeded" };
    }
    return this.signaling.handle(actor, data);
  }

  /** One limiter per device, so opening more sockets does not raise its event budget. */
  private limiterFor(deviceId: string): ConnectionRateLimiter {
    const existing = this.limiters.get(deviceId);
    if (existing) {
      return existing;
    }
    const limiter = new ConnectionRateLimiter();
    this.limiters.set(deviceId, limiter);
    return limiter;
  }

  private refuse(client: SignalingSocket, code: SignalingErrorCode, message: string): void {
    client.emit(SIGNAL_EVENT, { type: "signal.error", code, message } satisfies SignalingReply);
    client.disconnect(true);
  }
}
