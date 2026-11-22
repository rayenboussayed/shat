import { Injectable } from "@nestjs/common";

/** The part of a socket connection the signaling layer uses. */
export interface SignalingClient {
  readonly connected: boolean;
  emit(event: string, data: unknown): boolean;
  disconnect(close?: boolean): unknown;
}

/** Most sockets one device may hold open on this instance. */
export const MAX_SOCKETS_PER_DEVICE = 4;

/**
 * Maps authenticated device ids to their open sockets on this instance.
 *
 * Presence is local to the process: a device connected to another instance is
 * reported offline here. Multi-instance routing is unresolved (spec §9.5).
 */
@Injectable()
export class ConnectionRegistry {
  private readonly sockets = new Map<string, Set<SignalingClient>>();

  /**
   * Records an open socket for a device.
   *
   * @param deviceId - The authenticated device.
   * @param client - The open socket.
   * @returns False when the device already holds MAX_SOCKETS_PER_DEVICE sockets.
   */
  add(deviceId: string, client: SignalingClient): boolean {
    const existing = this.sockets.get(deviceId);
    if (!existing) {
      this.sockets.set(deviceId, new Set([client]));
      return true;
    }
    if (existing.size >= MAX_SOCKETS_PER_DEVICE) {
      return false;
    }
    existing.add(client);
    return true;
  }

  /**
   * Counts the sockets a device holds on this instance.
   *
   * @param deviceId - The authenticated device.
   * @returns The number of registered sockets.
   */
  socketCount(deviceId: string): number {
    return this.sockets.get(deviceId)?.size ?? 0;
  }

  /**
   * Forgets a socket when it closes.
   *
   * @param deviceId - The authenticated device.
   * @param client - The closed socket.
   */
  remove(deviceId: string, client: SignalingClient): void {
    const existing = this.sockets.get(deviceId);
    if (!existing) {
      return;
    }
    existing.delete(client);
    if (existing.size === 0) {
      this.sockets.delete(deviceId);
    }
  }

  /**
   * Reports whether a device has at least one open socket here.
   *
   * @param deviceId - The device to look up.
   * @returns True when the device is connected to this instance.
   */
  isOnline(deviceId: string): boolean {
    return [...(this.sockets.get(deviceId) ?? [])].some((client) => client.connected);
  }

  /**
   * Emits an event to every open socket of one device.
   *
   * @param deviceId - The recipient device.
   * @param event - The socket event name.
   * @param data - The JSON-serializable body.
   * @returns How many sockets the event was handed to.
   */
  sendTo(deviceId: string, event: string, data: unknown): number {
    const targets = this.sockets.get(deviceId);
    if (!targets) {
      return 0;
    }
    let sent = 0;
    for (const client of targets) {
      if (client.connected) {
        client.emit(event, data);
        sent += 1;
      }
    }
    return sent;
  }
}
