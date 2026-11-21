import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { HealthController } from "./health.controller.ts";
import { AllExceptionsFilter } from "./app.filter.ts";
import { DatabaseShutdown } from "./shutdown.provider.ts";

/** Root module wiring the health endpoint, error filter and shutdown hook. */
@Module({
  controllers: [HealthController],
  providers: [
    DatabaseShutdown,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
