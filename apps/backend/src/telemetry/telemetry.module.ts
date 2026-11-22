import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.ts";
import { DatabaseModule } from "../db/db.ts";
import { TelemetryController } from "./telemetry.controller.ts";
import { TelemetryMiddleware } from "./telemetry.middleware.ts";
import { TelemetryRepository } from "./telemetry.repository.ts";
import { TelemetryService } from "./telemetry.service.ts";
import { TELEMETRY_STORE, TELEMETRY_WINDOW_MS, TelemetryStore } from "./telemetry.store.ts";

/** Wires aggregated telemetry: the counter store, request middleware and admin summary. */
@Module({
  imports: [DatabaseModule, AdminModule],
  controllers: [TelemetryController],
  providers: [
    {
      provide: TELEMETRY_STORE,
      useFactory: () => new TelemetryStore(TELEMETRY_WINDOW_MS),
    },
    TelemetryMiddleware,
    TelemetryRepository,
    TelemetryService,
  ],
})
export class TelemetryModule implements NestModule {
  /** Counts every route, including ones rejected by guards. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TelemetryMiddleware).forRoutes("*splat");
  }
}
