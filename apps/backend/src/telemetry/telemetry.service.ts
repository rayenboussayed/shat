import { Inject, Injectable } from "@nestjs/common";
import type { CounterSnapshot } from "./telemetry.store.ts";
import { TELEMETRY_STORE, TelemetryStore } from "./telemetry.store.ts";
import { TelemetryRepository } from "./telemetry.repository.ts";
import type { StorageTotals } from "./telemetry.repository.ts";

/** Privacy-preserving operational summary: window counters plus identifier-free totals. */
export interface TelemetrySummary extends CounterSnapshot, StorageTotals {}

/** Combines the in-memory window counters with database totals for the admin summary. */
@Injectable()
export class TelemetryService {
  constructor(
    @Inject(TELEMETRY_STORE) private readonly store: TelemetryStore,
    private readonly repository: TelemetryRepository,
  ) {}

  /** Returns the current window counters and storage totals. */
  async summary(): Promise<TelemetrySummary> {
    const counters = this.store.snapshot();
    const totals = await this.repository.totals(new Date());
    return { ...counters, ...totals };
  }
}
