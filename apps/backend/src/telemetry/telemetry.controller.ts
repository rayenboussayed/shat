import { Controller, Get, UseFilters, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../admin/admin.guard.ts";
import { ServiceUnavailableFilter } from "../admin/service-unavailable.filter.ts";
import { TelemetryService } from "./telemetry.service.ts";
import type { TelemetrySummary } from "./telemetry.service.ts";

/** Admin-only aggregated telemetry. Requires the SHAT_ADMIN_TOKEN header. */
@Controller("telemetry")
@UseGuards(AdminGuard)
@UseFilters(ServiceUnavailableFilter)
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** Returns window counters and identifier-free storage totals. */
  @Get("summary")
  summary(): Promise<TelemetrySummary> {
    return this.telemetry.summary();
  }
}
