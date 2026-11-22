import { Controller, Get, UseFilters, UseGuards } from "@nestjs/common";
import { HealthCheck, HealthCheckService, HealthIndicatorService } from "@nestjs/terminus";
import { AdminGuard } from "./admin.guard.ts";
import { DatabaseHealthIndicator } from "./database.health.ts";
import { ServiceUnavailableFilter } from "./service-unavailable.filter.ts";

/**
 * Operator health endpoints, separate from the public /health route. Liveness touches no
 * dependency; readiness checks the database. Both require the admin token.
 */
@Controller("admin/health")
@UseGuards(AdminGuard)
@UseFilters(ServiceUnavailableFilter)
export class AdminHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /** Reports that the process is running, without checking any dependency. */
  @Get("live")
  @HealthCheck()
  live() {
    return this.health.check([
      () => this.indicators.check("process").up({ uptimeSeconds: Math.floor(process.uptime()) }),
    ]);
  }

  /** Reports whether the service can serve requests, including a database probe. */
  @Get("ready")
  @HealthCheck()
  ready() {
    return this.health.check([() => this.database.check()]);
  }
}
