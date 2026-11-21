/**
 * Transport contracts for SHAT mobile.
 *
 * Native transports (Wi-Fi Direct/Aware) are not implemented here and are
 * unverified in this environment.
 */

/** Supported transport modes. */
export type TransportMode =
  | "online"
  | "wifi-direct"
  | "wifi-aware"
  | "offline";

/** A discovered peer. */
export interface Peer {
  readonly id: string;
  readonly displayName: string;
  readonly mode: TransportMode;
}

/** Options for peer discovery. */
export interface DiscoveryOptions {
  readonly mode: TransportMode;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** A secure channel between two peers. */
export interface SecureChannel {
  /** Peer identifier. */
  readonly peerId: string;
  /** Send a payload with backpressure. */
  send(payload: Uint8Array): Promise<void>;
  /** Receive payloads. */
  receive(): AsyncIterable<Uint8Array>;
  /** Close the channel. */
  close(): Promise<void>;
}

/** Capabilities reported by a transport. */
export interface TransportCapabilities {
  readonly supportsDiscovery: boolean;
  readonly supportsCancellation: boolean;
  readonly supportsBackpressure: boolean;
  readonly supportsTimeouts: boolean;
  readonly identityBinding: boolean;
}

/**
 * Secure transport interface. Implementations must honor cancellation,
 * backpressure, timeouts and identity binding as documented.
 */
export interface SecureTransport {
  /** Transport mode. */
  readonly mode: TransportMode;
  /** Reported capabilities. */
  readonly capabilities: TransportCapabilities;
  /** Discover peers (cancellable via options.signal). */
  discover(options: DiscoveryOptions): AsyncIterable<Peer>;
  /** Connect to a peer (cancellable via signal). */
  connect(peerId: string, signal?: AbortSignal): Promise<SecureChannel>;
  /** Disconnect from a peer. */
  disconnect(peerId: string): Promise<void>;
}

/**
 * Fail-closed, unverified online adapter.
 *
 * This adapter is documented as unverified: it performs no network I/O and
 * reports no capabilities. It exists only to satisfy the `SecureTransport`
 * contract shape; callers must not treat it as working.
 */
export class OnlineTransportAdapter implements SecureTransport {
  /** Always true: this adapter is unverified. */
  readonly unverified = true;

  readonly mode: TransportMode = "online";

  readonly capabilities: TransportCapabilities = {
    supportsDiscovery: false,
    supportsCancellation: false,
    supportsBackpressure: false,
    supportsTimeouts: false,
    identityBinding: false,
  };

  /**
   * Unverified: yields no peers (fail-closed).
   *
   * @param options - Discovery options (ignored).
   */
  async *discover(options: DiscoveryOptions): AsyncIterable<Peer> {
    void options;
    // Unverified: no discovery is performed.
    return;
  }

  /**
   * Unverified: always returns a rejected promise via the explicit
   * `unverified` capability check.
   *
   * @param peerId - Target peer id (ignored).
   * @param signal - Optional cancellation signal (ignored).
   */
  async connect(peerId: string, signal?: AbortSignal): Promise<SecureChannel> {
    void peerId;
    void signal;
    if (this.unverified) {
      return Promise.reject(
        new Error("OnlineTransportAdapter is unverified and fail-closed"),
      );
    }
    return Promise.reject(
      new Error("OnlineTransportAdapter is unverified and fail-closed"),
    );
  }

  /**
   * Unverified: no-op (fail-closed).
   *
   * @param peerId - Target peer id (ignored).
   */
  async disconnect(peerId: string): Promise<void> {
    void peerId;
    return;
  }
}
