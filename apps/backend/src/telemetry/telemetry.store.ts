/** Injection token for the in-memory telemetry counter store. */
export const TELEMETRY_STORE = Symbol("TELEMETRY_STORE");

/** Length of one aggregation window in milliseconds. Counters reset when a window ends. */
export const TELEMETRY_WINDOW_MS = 60 * 60 * 1000;

/** The only counters the store accepts. Nothing else can be recorded, by design. */
const COUNTER_METRICS = ["requests", "errors"] as const;

/** Name of a counter the store accepts. */
export type CounterMetric = (typeof COUNTER_METRICS)[number];

/** Aggregated counters for one window, with the window bounds in ISO-8601 UTC. */
export interface CounterSnapshot {
  readonly startedAt: string;
  readonly endsAt: string;
  readonly requests: number;
  readonly errors: number;
}

function isCounterMetric(value: unknown): value is CounterMetric {
  return COUNTER_METRICS.some((metric) => metric === value);
}

/**
 * Process-local counters aggregated per fixed window. Only allowlisted names and
 * non-negative integers are accepted, so no identifier, address, key or content can be
 * recorded. Windows are fixed-length and dropped at rollover, which bounds retention.
 */
export class TelemetryStore {
  private windowStartMs: number;
  private counters: Record<CounterMetric, number> = { requests: 0, errors: 0 };

  /**
   * @param windowMs Length of one aggregation window in milliseconds.
   * @param now Clock returning epoch milliseconds; injectable for tests.
   */
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.windowStartMs = this.alignedStart();
  }

  /**
   * Adds to a counter in the current window.
   *
   * @throws TypeError when the name is not an allowlisted counter.
   * @throws RangeError when the amount is not a non-negative safe integer.
   */
  increment(metric: CounterMetric, amount = 1): void {
    if (!isCounterMetric(metric)) {
      throw new TypeError("Unknown telemetry metric");
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RangeError("Telemetry amounts must be non-negative integers");
    }
    this.rotate();
    this.counters[metric] += amount;
  }

  /** Returns the counters of the current window, rolling the window over first if it ended. */
  snapshot(): CounterSnapshot {
    this.rotate();
    return {
      startedAt: new Date(this.windowStartMs).toISOString(),
      endsAt: new Date(this.windowStartMs + this.windowMs).toISOString(),
      requests: this.counters.requests,
      errors: this.counters.errors,
    };
  }

  private alignedStart(): number {
    const current = this.now();
    return current - (current % this.windowMs);
  }

  private rotate(): void {
    const start = this.alignedStart();
    if (start === this.windowStartMs) {
      return;
    }
    this.windowStartMs = start;
    this.counters = { requests: 0, errors: 0 };
  }
}
